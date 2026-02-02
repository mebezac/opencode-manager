# Kubernetes Integration

OpenCode Manager supports Kubernetes integration for creating isolated testing environments in pods.

## Overview

The Kubernetes integration allows you to:
- Create and manage ephemeral pods for testing code in isolated environments
- Create Kubernetes Services for inter-pod networking
- Create Kubernetes Ingresses for external access
- Execute commands inside running pods
- View pod status and logs
- Clean up old pods automatically
- Use prebuilt container images instead of installing dependencies locally
- Set up multi-pod environments (e.g., database + application)
- Share source code between manager and ephemeral pods via PVC
- Create staging/preview deployments with Services and Ingresses

## Prerequisites

### Kubernetes Cluster Access

You need access to a Kubernetes cluster with appropriate permissions. The integration uses the official Kubernetes JavaScript client library.

### Kubeconfig

OpenCode Manager can use:
- Default kubeconfig location (`/workspace/.kube/kubeconfig`)
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
  namespace: opencode-manager
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: opencode-manager
  namespace: opencode-manager
rules:
- apiGroups: [""]
  resources: ["pods", "pods/log", "pods/exec", "services", "ingresses"]
  verbs: ["get", "list", "create", "delete", "exec"]
- apiGroups: ["networking.k8s.io"]
  resources: ["ingresses"]
  verbs: ["get", "list", "create", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: opencode-manager
  namespace: opencode-manager
subjects:
- kind: ServiceAccount
  name: opencode-manager
  namespace: opencode-manager
roleRef:
  kind: Role
  name: opencode-manager
  apiGroup: rbac.authorization.k8s.io
```

Apply with:
```bash
kubectl create namespace opencode-manager
kubectl apply -f rbac.yaml
```

### 2. Get ServiceAccount Token

Generate a long-lived token for authentication:

```bash
kubectl create token opencode-manager -n opencode-manager --duration=8760h
```

Copy this token - you'll use it to configure OpenCode Manager.

### 3. Get Cluster CA Certificate

If your cluster uses HTTPS with a self-signed certificate, you need to add the CA certificate to your kubeconfig:

```bash
# Get the CA certificate from your cluster
kubectl config view --raw --minify --flatten -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' > /tmp/ca-cert.base64

# Or get it from the cluster's secret (for in-cluster access)
kubectl get secret -n kube-system -o jsonpath='{.items[?(@.type=="kubernetes.io/service-account-token")].data.ca\.crt}' | head -1
```

Convert the base64 certificate to proper format if needed.

### 4. Configure Kubeconfig

Create a minimal kubeconfig file with your token and CA certificate:

```yaml
apiVersion: v1
clusters:
- cluster:
    server: https://kubernetes.default.svc
    certificate-authority-data: LS0tLS1CRUdJTi...
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

Replace `<YOUR_TOKEN_HERE>` with the token from step 2 and `certificate-authority-data` with your actual CA certificate in base64 encoding.

## Alternative: Use Existing Kubeconfig

If you already have a working `kubectl` setup with a valid kubeconfig, you can copy that file:

```bash
# Copy your existing kubeconfig
cp ~/.kube/config /workspace/.kube/kubeconfig

# Or export the current context only
kubectl config view --minify --flatten > /workspace/.kube/kubeconfig
```

Save this file and provide its path to OpenCode Manager in the Kubernetes settings.

## TLS Certificate Configuration

### Self-Signed Certificates

If your Kubernetes cluster uses self-signed certificates, you need to configure Node.js to trust your CA certificate.

### Recommended: NODE_EXTRA_CA_CERTS Environment Variable

Mount your CA certificate and set the environment variable:

```yaml
# docker-compose.yml
services:
  opencode-manager:
    volumes:
      - ./ca.crt:/workspace/.kube/ca.crt:ro
    environment:
      - NODE_EXTRA_CA_CERTS=/workspace/.kube/ca.crt
```

Or with Docker:
```bash
docker run -e NODE_EXTRA_CA_CERTS=/workspace/.kube/ca.crt -v ./ca.crt:/workspace/.kube/ca.crt:ro ...
```

This is the simplest and most reliable method for handling self-signed certificates in Docker environments.

### Alternative: CA Certificate in Kubeconfig

If your kubeconfig already contains the CA certificate in `certificate-authority-data`, Node.js will use it automatically. This is the case when using:
- A kubeconfig exported from a working `kubectl` setup
- A kubeconfig generated by your cloud provider's CLI tools
- A kubeconfig created with `kubectl config set-cluster --certificate-authority=...`

## Usage

### Enable Kubernetes Integration

1. Go to **Settings → Kubernetes**
2. Toggle "Enable Kubernetes" to ON
3. Set your namespace (default: `opencode-manager`)
4. Optionally specify a kubeconfig path (default: `/workspace/.kube/kubeconfig`)
5. Click **Test Connection** to verify

### Creating Pods

Pods can be created programmatically via the API:

```bash
POST /api/kubernetes/pods
{
  "name": "test-runner",
  "namespace": "opencode-manager",
  "image": "node:20-alpine",
  "command": ["sh"],
  "mountPath": "/workspace",
  "hostPath": "/path/to/workspace",
  "labels": {
    "app": "test-runner"
  }
}
```

The `labels` field is optional but useful for creating Services that target specific pods.

### Creating Services

Services expose pods and enable inter-pod networking:

```bash
POST /api/kubernetes/services
{
  "name": "my-service",
  "namespace": "opencode-manager",
  "selector": {
    "app": "test-runner"
  },
  "ports": [
    {
      "port": 8080,
      "targetPort": 8080,
      "protocol": "TCP"
    }
  ],
  "type": "ClusterIP"
}
```

Service types:
- **ClusterIP** (default): Internal cluster IP only
- **NodePort**: Exposes service on each node's IP at a static port
- **LoadBalancer**: Creates an external load balancer (cloud provider dependent)

### Creating Ingresses

Ingresses expose pods and services externally via HTTP/HTTPS routes:

```bash
POST /api/kubernetes/ingresses
{
  "name": "my-app-ingress",
  "namespace": "opencode-manager",
  "rules": [
    {
      "host": "myapp.example.com",
      "http": {
        "paths": [
          {
            "path": "/",
            "pathType": "Prefix",
            "backend": {
              "service": {
                "name": "my-service",
                "port": {
                  "number": 8080
                }
              }
            }
          }
        ]
      }
    }
  ],
  "annotations": {
    "nginx.ingress.kubernetes.io/rewrite-target": "/"
  }
}
```

Use ingresses when you need to:
- Expose pods externally via HTTP/HTTPS
- Route traffic to services based on hostnames or paths
- Terminate SSL/TLS at the ingress controller
- Enable WebSocket connections to pods (with proper annotations)

**Note:** Requires an ingress controller (e.g., nginx-ingress) installed in your cluster.

### Managing Pods

Once connected, you can:
- **View pods**: See all pods in the configured namespace
- **Check status**: See pod phase (Running, Pending, Succeeded, Failed)
- **View logs**: Fetch pod logs via the UI or API
- **Exec commands**: Run commands inside pods
- **Pod terminal**: Open an interactive terminal in running pods
- **Delete pods**: Remove individual pods or cleanup old ones

### Interactive Pod Terminal

OpenCode Manager provides an interactive web-based terminal for pods:

1. Navigate to the pod list
2. Find the running pod you want to access
3. Click the **Terminal** button
4. An interactive shell session opens in your browser

**Requirements:**
- Pod must be in `Running` state
- Container image must have `/bin/sh` available
- Port 5004 must be exposed (for WebSocket communication)
- ServiceAccount must have `pods/exec` permission

**How it works:**
- The browser connects via WebSocket to port 5004
- The backend opens a WebSocket connection to the Kubernetes API
- Bidirectional streaming allows typing commands and seeing output in real-time
- Supports terminal resizing and basic TTY functionality

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
| `/api/kubernetes/services` | GET | List services in namespace |
| `/api/kubernetes/services` | POST | Create new service |
| `/api/kubernetes/services/:name` | GET | Get service details |
| `/api/kubernetes/services/:name` | DELETE | Delete service |
| `/api/kubernetes/ingresses` | GET | List ingresses in namespace |
| `/api/kubernetes/ingresses` | POST | Create new ingress |
| `/api/kubernetes/ingresses/:name` | GET | Get ingress details |
| `/api/kubernetes/ingresses/:name` | DELETE | Delete ingress |

## Advanced Workflows

### Matching Container Images to Project Requirements

When creating pods for testing or staging, ensure the container image matches the project's language/runtime version requirements:

**Check these files for version requirements:**

| File | Purpose | Example Values |
|------|---------|----------------|
| `mise.toml` or `.tool-versions` | mise version manager | `node 20.11.0`, `python 3.12.0` |
| `package.json` (`engines.node`) | Node.js version | `"node": ">=20.0.0"` |
| `.nvmrc` or `.node-version` | Node.js version manager | `20.11.0` |
| `.python-version` | Python version | `3.12.0` |
| `Dockerfile` (`FROM` image) | Base container image | `node:20-alpine`, `python:3.12-slim` |
| `Gemfile` (`ruby` directive) | Ruby version | `ruby "3.2.0"` |
| `go.mod` (`go` directive) | Go version | `go 1.21` |
| `Cargo.toml` (`package.rust-version`) | Rust version | `rust-version = "1.75"` |
| `pom.xml` or `build.gradle` | Java version | `<java.version>21</java.version>` |

**Best Practice:**
Always specify exact versions in pod image tags rather than using `latest` or major version aliases:
- ✅ Use: `node:20.11.0-alpine`
- ❌ Avoid: `node:latest` or `node:20`

**Example - Checking mise.toml:**
```bash
# If mise.toml contains:
# [tools]
# node = "20.11.0"

# Use this image:
POST /api/kubernetes/pods
{
  "name": "test-runner",
  "image": "node:20.11.0-alpine",
  ...
}
```

**Example - Checking Dockerfile:**
```bash
# If Dockerfile contains:
# FROM node:20.11.0-alpine

# Use the same image for testing:
POST /api/kubernetes/pods
{
  "name": "test-runner",
  "image": "node:20.11.0-alpine",
  ...
}
```

### Shared PVC with Git-Based State Synchronization

For development workflows where OpenCode Manager edits files and ephemeral pods run tests/builds, use a shared PVC mounted by both:

**Architecture:**
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  OpenCode       │────▶│  Shared PVC      │◄────│  Ephemeral Pods │
│  Manager        │     │  (Longhorn RWX)  │     │  (test/build)   │
│  (edits files)  │     │                  │     │  (staging)      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
          │                        │                       │
          ▼                        ▼                       ▼
   Git commits as           Mount /workspace/repos   Checkout SHA
   "sync points"            Same filesystem view      Run task
```

**Why Git Commits for Synchronization:**
- **Lightweight**: No PVC snapshot overhead
- **Deterministic**: Commit SHA guarantees identical state
- **Parallelizable**: Multiple pods can checkout different SHAs simultaneously
- **Versioned**: Natural rollback via git history

**Setup Requirements:**
- Storage class supporting `ReadWriteMany` (RWX) access mode (e.g., Longhorn, NFS, EFS)
- Manager and test pods in same namespace (or cross-namespace PVC with RBAC)
- Git initialized in the repository

**Workflow:**

1. **Manager makes edits** → commits changes (even WIP commits)
2. **Spawn test pod** with:
   - Same PVC mounted
   - Commit SHA passed as environment variable
   - Entrypoint checks out the specific commit before running tests
3. **Pod runs tests/build** → reports results back
4. **Manager adjusts** → new commit → new pod iteration
5. **Repeat** until tests pass

**Example Test Pod with Git Checkout:**

```bash
POST /api/kubernetes/pods
{
  "name": "test-runner-abc123",
  "namespace": "opencode-manager",
  "image": "node:20-alpine",
  "env": {
    "COMMIT_SHA": "abc123def456",
    "REPO_PATH": "/workspace/repos/myapp"
  },
  "command": ["sh"],
  "args": ["-c", "cd $REPO_PATH && git checkout $COMMIT_SHA && npm ci && npm test"]
}
```

**RBAC for PVC Access:**

Add PVC permissions to the ServiceAccount:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: opencode-manager
  namespace: opencode-manager
rules:
- apiGroups: [""]
  resources: ["pods", "pods/log", "pods/exec", "services", "ingresses", "persistentvolumeclaims"]
  verbs: ["get", "list", "create", "delete", "exec"]
- apiGroups: ["networking.k8s.io"]
  resources: ["ingresses"]
  verbs: ["get", "list", "create", "delete"]
```

### Debug/Test Loop Workflow

Use ephemeral pods for iterative debugging without consuming manager resources:

**Pattern:**
1. Edit code in OpenCode Manager
2. Create WIP commit: `git add . && git commit -m "wip: debugging test failure"`
3. Spawn ephemeral pod with that commit SHA
4. Pod runs tests and reports failure
5. Manager analyzes results, makes fixes
6. New commit → new pod
7. Continue until tests pass

**Benefits:**
- Manager stays responsive (not running CPU-intensive tasks)
- Clean environment per iteration
- Previous test pods remain for comparison (until cleanup)
- Full isolation between test runs

**Example API Sequence:**

```bash
# 1. Manager makes edits and commits
# (Handled by OpenCode Manager UI/tools)

# 2. Create test pod with specific commit
curl -X POST http://localhost:5003/api/kubernetes/pods \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-iteration-1",
    "namespace": "opencode-manager",
    "image": "node:20-alpine",
    "env": {
      "COMMIT_SHA": "a1b2c3d4",
      "REPO_PATH": "/workspace/repos/myapp"
    },
    "command": ["sh"],
    "args": ["-c", "cd $REPO_PATH && git checkout $COMMIT_SHA && npm ci && npm run test:ci"]
  }'

# 3. Check test results via logs
curl http://localhost:5003/api/kubernetes/pods/test-iteration-1/logs?namespace=opencode-manager

# 4. If tests fail, manager fixes code and repeats with new commit
# 5. Once tests pass, cleanup old pods
curl -X POST http://localhost:5003/api/kubernetes/cleanup \
  -H "Content-Type: application/json" \
  -d '{"namespace": "opencode-manager"}'
```

### Staging/Preview Deployments

Create accessible preview environments using Services and Ingresses:

**Pattern:**
1. Build app in ephemeral pod with shared PVC
2. Create Service to expose the pod
3. Create Ingress for external access
4. User can interact with the deployed app
5. Cleanup when done

**Example: Node.js App Preview:**

```bash
# 1. Create build pod that stays running
curl -X POST http://localhost:5003/api/kubernetes/pods \
  -H "Content-Type: application/json" \
  -d '{
    "name": "preview-app-abc123",
    "namespace": "opencode-manager",
    "image": "node:20-alpine",
    "env": {
      "COMMIT_SHA": "abc123",
      "REPO_PATH": "/workspace/repos/myapp",
      "PORT": "3000"
    },
    "command": ["sh"],
    "args": ["-c", "cd $REPO_PATH && git checkout $COMMIT_SHA && npm ci && npm run build && npm start"],
    "labels": {"app": "preview-abc123"}
  }'

# 2. Create Service to expose the pod
curl -X POST http://localhost:5003/api/kubernetes/services \
  -H "Content-Type: application/json" \
  -d '{
    "name": "preview-service-abc123",
    "namespace": "opencode-manager",
    "selector": {"app": "preview-abc123"},
    "ports": [{"port": 3000, "targetPort": 3000}],
    "type": "ClusterIP"
  }'

# 3. Create Ingress for external access
curl -X POST http://localhost:5003/api/kubernetes/ingresses \
  -H "Content-Type: application/json" \
  -d '{
    "name": "preview-ingress-abc123",
    "namespace": "opencode-manager",
    "rules": [{
      "host": "preview-abc123.example.com",
      "http": {
        "paths": [{
          "path": "/",
          "pathType": "Prefix",
          "backend": {
            "service": {
              "name": "preview-service-abc123",
              "port": {"number": 3000}
            }
          }
        }]
      }
    }]
  }'
```

**Accessing the Preview:**
- The app is now accessible at `http://preview-abc123.example.com`
- DNS must be configured to point to your ingress controller
- Multiple previews can run simultaneously with different hostnames

**Cleanup When Done:**

```bash
# Delete ingress
curl -X DELETE http://localhost:5003/api/kubernetes/ingresses/preview-ingress-abc123?namespace=opencode-manager

# Delete service
curl -X DELETE http://localhost:5003/api/kubernetes/services/preview-service-abc123?namespace=opencode-manager

# Delete pod
curl -X DELETE http://localhost:5003/api/kubernetes/pods/preview-app-abc123?namespace=opencode-manager
```

## Docker Compose Configuration

When running OpenCode Manager in Docker, ensure the container can access your Kubernetes cluster:

### Basic Setup

```yaml
services:
  opencode-manager:
    ports:
      - "5003:5003"
      - "5004:5004"  # Required for pod terminal WebSocket
    volumes:
      - /workspace/.kube/kubeconfig:/workspace/.kube/kubeconfig:ro
      - workspace-volume:/workspace
```

**Note:** Port 5004 is required for the pod terminal feature. The backend runs on port 5003, and the WebSocket server for pod exec runs on port 5004.

### With Self-Signed Certificates

```yaml
services:
  opencode-manager:
    ports:
      - "5003:5003"
      - "5004:5004"
    volumes:
      - /workspace/.kube/kubeconfig:/workspace/.kube/kubeconfig:ro
      - ./ca.crt:/workspace/.kube/ca.crt:ro
      - workspace-volume:/workspace
    environment:
      - NODE_EXTRA_CA_CERTS=/workspace/.kube/ca.crt
```

**Important:** When using self-signed certificates, mount the CA certificate to `/workspace/.kube/ca.crt` and set `NODE_EXTRA_CA_CERTS=/workspace/.kube/ca.crt`. This path is used for validating the Kubernetes API server certificate.

## Troubleshooting

### Connection Failed

1. Verify kubeconfig path and contents
2. Check network connectivity to cluster API server
3. Ensure ServiceAccount token is valid and not expired
4. Verify RBAC permissions are correctly applied

### Certificate Verification Errors

If you see "unable to verify the first certificate" (UNABLE_TO_VERIFY_LEAF_SIGNATURE) or similar SSL/TLS errors:

1. Get the CA certificate from your cluster:
   ```bash
   kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d > ca.crt
   ```

2. Mount the certificate and set the environment variable:
   ```yaml
   environment:
     - NODE_EXTRA_CA_CERTS=/workspace/.kube/ca.crt
   volumes:
     - ./ca.crt:/workspace/.kube/ca.crt:ro
   ```

3. Restart the container

### Pod Creation Failed

1. Check namespace exists: `kubectl get namespace <your-namespace>`
2. Verify image is accessible from your cluster
3. Check pod logs with `kubectl logs <pod-name> -n <namespace>`
4. Ensure sufficient resources in cluster

### Exec Failed

1. Verify pod is in Running state
2. Check container name is correct (default: `runner`)
3. Ensure command syntax is valid for the container image

### Pod Terminal Not Working

If the interactive pod terminal shows "Session closed" immediately:

1. **Check port 5004 is exposed**: The WebSocket server runs on port 5004 (API port + 1). Ensure it's exposed in Docker:
   ```yaml
   ports:
     - "5003:5003"
     - "5004:5004"
   ```

2. **Verify CA certificate path**: For self-signed certificates, mount to `/workspace/.kube/ca.crt`:
   ```yaml
   volumes:
     - ./ca.crt:/workspace/.kube/ca.crt:ro
   environment:
     - NODE_EXTRA_CA_CERTS=/workspace/.kube/ca.crt
   ```

3. **Check ServiceAccount permissions**: Ensure the ServiceAccount has `pods/exec` permission:
   ```yaml
   verbs: ["get", "list", "create", "delete", "exec"]
   ```

4. **Verify kubeconfig has token**: The pod terminal requires token-based authentication. Ensure your kubeconfig contains:
   ```yaml
   users:
   - name: opencode-manager
     user:
       token: <your-token-here>
   ```

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
6. **Use proper TLS**: Mount CA certificates via NODE_EXTRA_CA_CERTS for self-signed clusters
7. **Protect the manager pod**: When running OpenCode Manager in the same namespace as ephemeral pods, ensure cleanup operations don't terminate the manager. Add a distinct label (e.g., `app=opencode-manager`) to the manager pod/deployment and filter it out in cleanup operations

## Example Use Cases

### Testing with Specific Node Version

Create a pod with Node.js 20 and execute tests:

```bash
POST /api/kubernetes/pods
{
  "name": "node20-test",
  "namespace": "opencode-manager",
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
  "namespace": "opencode-manager",
  "image": "python:3.12-slim",
  "command": ["python", "-m", "pytest"]
}
```

### Multi-Pod Database Integration Testing

Create a complete postgres + application testing environment:

```bash
# 1. Create postgres pod with custom label
POST /api/kubernetes/pods
{
  "name": "postgres-db",
  "namespace": "opencode-manager",
  "image": "postgres:15-alpine",
  "labels": {
    "app": "postgres"
  },
  "env": {
    "POSTGRES_PASSWORD": "test123",
    "POSTGRES_DB": "myapp"
  }
}

# 2. Create service to expose postgres
POST /api/kubernetes/services
{
  "name": "postgres-service",
  "namespace": "opencode-manager",
  "selector": {
    "app": "postgres"
  },
  "ports": [
    {
      "port": 5432,
      "targetPort": 5432
    }
  ]
}

# 3. Create app pod that connects via service DNS
POST /api/kubernetes/pods
{
  "name": "app-test",
  "namespace": "opencode-manager",
  "image": "node:20-alpine",
  "env": {
    "DATABASE_URL": "postgresql://postgres:test123@postgres-service:5432/myapp"
  },
  "command": ["npm", "test"]
}
```

The app pod can now connect to postgres using the DNS name `postgres-service`, which Kubernetes automatically resolves to the postgres pod's IP address.

### Ingress with WebSocket Support

Create an ingress for the pod terminal WebSocket with nginx annotations:

```bash
# 1. Create a service for the pod terminal
POST /api/kubernetes/services
{
  "name": "pod-terminal-service",
  "namespace": "opencode-manager",
  "selector": {
    "app": "test-runner"
  },
  "ports": [
    {
      "port": 5004,
      "targetPort": 5004,
      "protocol": "TCP"
    }
  ],
  "type": "ClusterIP"
}

# 2. Create an ingress with WebSocket support
POST /api/kubernetes/ingresses
{
  "name": "pod-terminal-ingress",
  "namespace": "opencode-manager",
  "rules": [
    {
      "host": "terminal.example.com",
      "http": {
        "paths": [
          {
            "path": "/",
            "pathType": "Prefix",
            "backend": {
              "service": {
                "name": "pod-terminal-service",
                "port": {
                  "number": 5004
                }
              }
            }
          }
        ]
      }
    }
  ],
  "annotations": {
    "nginx.ingress.kubernetes.io/rewrite-target": "/",
    "nginx.ingress.kubernetes.io/proxy-read-timeout": "3600",
    "nginx.ingress.kubernetes.io/proxy-send-timeout": "3600",
    "nginx.ingress.kubernetes.io/proxy-http-version": "1.1",
    "nginx.ingress.kubernetes.io/proxy-buffering": "off",
    "nginx.ingress.kubernetes.io/connection-proxy-header": "keep-alive",
    "nginx.ingress.kubernetes.io/upgrade-proxy-header": "websocket"
  }
}
```

**WebSocket Annotations Explained:**
- `proxy-read-timeout` / `proxy-send-timeout`: Increase timeout for long-running WebSocket connections
- `proxy-http-version`: Use HTTP/1.1 for WebSocket upgrade support
- `proxy-buffering`: Disable buffering for real-time bidirectional communication
- `connection-proxy-header` / `upgrade-proxy-header`: Enable WebSocket protocol upgrade

## Additional Resources

- [Kubernetes JavaScript Client Docs](https://github.com/kubernetes-client/javascript)
- [Kubernetes RBAC Documentation](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
- [Pod Security Context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/)
