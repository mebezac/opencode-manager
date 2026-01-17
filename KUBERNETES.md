# Kubernetes Integration

OpenCode Manager supports Kubernetes integration for creating isolated testing environments in pods.

## Overview

The Kubernetes integration allows you to:
- Create and manage ephemeral pods for testing code in isolated environments
- Execute commands inside running pods
- View pod status and logs
- Clean up old pods automatically
- Use prebuilt container images instead of installing dependencies locally

## Prerequisites

### Kubernetes Cluster Access

You need access to a Kubernetes cluster with appropriate permissions. The integration uses the official Kubernetes JavaScript client library.

### Kubeconfig

OpenCode Manager can use:
- Your default kubeconfig location (`~/.kube/config`)
- A custom kubeconfig file path
- In-cluster authentication (when running inside Kubernetes)

## Setup

### 1. RBAC Configuration

Create a ServiceAccount with limited permissions for pod management:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: opencode-manager
  namespace: opencode-testing
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: opencode-manager
  namespace: opencode-testing
rules:
- apiGroups: [""]
  resources: ["pods", "pods/log", "pods/exec"]
  verbs: ["get", "list", "create", "delete", "exec"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: opencode-manager
  namespace: opencode-testing
subjects:
- kind: ServiceAccount
  name: opencode-manager
  namespace: opencode-testing
roleRef:
  kind: Role
  name: opencode-manager
  apiGroup: rbac.authorization.k8s.io
```

Apply with:
```bash
kubectl create namespace opencode-testing
kubectl apply -f rbac.yaml
```

### 2. Get ServiceAccount Token

Generate a long-lived token for authentication:

```bash
kubectl create token opencode-manager -n opencode-testing --duration=8760h
```

Copy this token - you'll use it to configure OpenCode Manager.

### 3. Configure Kubeconfig

Create a minimal kubeconfig file with your token:

```yaml
apiVersion: v1
clusters:
- cluster:
    server: https://kubernetes.default.svc
  name: kubernetes
contexts:
- context:
    cluster: kubernetes
    user: opencode-manager
  name: opencode-manager
current-context: opencode-manager
kind: Config
preferences: {}
users:
- name: opencode-manager
  user:
    token: <YOUR_TOKEN_HERE>
```

Save this file and provide its path to OpenCode Manager in the Kubernetes settings.

## Usage

### Enable Kubernetes Integration

1. Go to **Settings → Kubernetes**
2. Toggle "Enable Kubernetes" to ON
3. Set your namespace (default: `opencode-testing`)
4. Optionally specify a kubeconfig path
5. Click **Test Connection** to verify

### Creating Pods

Pods can be created programmatically via the API:

```bash
POST /api/kubernetes/pods
{
  "name": "test-runner",
  "namespace": "opencode-testing",
  "image": "node:20-alpine",
  "command": ["sh"],
  "mountPath": "/workspace",
  "hostPath": "/path/to/workspace"
}
```

### Managing Pods

Once connected, you can:
- **View pods**: See all pods in the configured namespace
- **Check status**: See pod phase (Running, Pending, Succeeded, Failed)
- **View logs**: Fetch pod logs via the UI or API
- **Exec commands**: Run commands inside pods
- **Delete pods**: Remove individual pods or cleanup old ones

### API Endpoints

| Endpoint | Method | Description |
|----------|---------|-------------|
| `/api/kubernetes/config` | GET | Get current K8s config and connection status |
| `/api/kubernetes/config` | PUT | Update K8s configuration |
| `/api/kubernetes/test-connection` | POST | Test connection to cluster |
| `/api/kubernetes/pods` | GET | List pods in namespace |
| `/api/kubernetes/pods` | POST | Create new pod |
| `/api/kubernetes/pods/:name` | GET | Get pod details |
| `/api/kubernetes/pods/:name` | DELETE | Delete pod |
| `/api/kubernetes/pods/:name/logs` | GET | Get pod logs |
| `/api/kubernetes/pods/:name/exec` | POST | Execute command in pod |
| `/api/kubernetes/cleanup` | POST | Delete old completed pods |

## Security

### Least Privilege

The RBAC configuration follows the principle of least privilege:
- Only pod operations are allowed
- Limited to a specific namespace
- No cluster-wide permissions
- No access to secrets, configmaps, or other resources

### Best Practices

1. **Use dedicated namespace**: Create a separate namespace for OpenCode Manager testing
2. **Limit pod resources**: Add resource limits to pod specs
3. **Enable network policies**: Restrict pod-to-pod communication
4. **Regular cleanup**: Use the cleanup feature to remove old pods
5. **Monitor usage**: Watch pod usage patterns in your cluster

## Docker Compose Configuration

When running OpenCode Manager in Docker, ensure the container can access your Kubernetes cluster:

```yaml
services:
  opencode-manager:
    volumes:
      - ~/.kube/config:/app/.kube/config:ro
      - workspace-volume:/workspace
```

## Troubleshooting

### Connection Failed

1. Verify kubeconfig path and contents
2. Check network connectivity to cluster API server
3. Ensure ServiceAccount token is valid and not expired
4. Verify RBAC permissions are correctly applied

### Pod Creation Failed

1. Check namespace exists: `kubectl get namespace <your-namespace>`
2. Verify image is accessible from your cluster
3. Check pod logs with `kubectl logs <pod-name> -n <namespace>`
4. Ensure sufficient resources in cluster

### Exec Failed

1. Verify pod is in Running state
2. Check container name is correct (default: `runner`)
3. Ensure command syntax is valid for the container image

## Example Use Cases

### Testing with Specific Node Version

Create a pod with Node.js 20 and execute tests:

```bash
POST /api/kubernetes/pods
{
  "name": "node20-test",
  "namespace": "opencode-testing",
  "image": "node:20-alpine",
  "command": ["npm", "test"]
}
```

### Python Environment Testing

Use a Python container for Python-based projects:

```bash
POST /api/kubernetes/pods
{
  "name": "python-test",
  "namespace": "opencode-testing",
  "image": "python:3.12-slim",
  "command": ["python", "-m", "pytest"]
}
```

### Database Integration Testing

Create a pod with database access for integration tests:

```bash
POST /api/kubernetes/pods
{
  "name": "db-test",
  "namespace": "opencode-testing",
  "image": "node:20-alpine",
  "env": {
    "DATABASE_URL": "postgres://user:pass@postgres:5432/db"
  }
}
```

## Additional Resources

- [Kubernetes JavaScript Client Docs](https://github.com/kubernetes-client/javascript)
- [Kubernetes RBAC Documentation](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
- [Pod Security Context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/)
