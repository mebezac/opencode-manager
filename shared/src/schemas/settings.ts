import { z } from "zod";

export const CustomCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  promptTemplate: z.string(),
});

export const CustomAgentSchema = z.object({
  name: z.string(),
  description: z.string(),
  config: z.record(z.string(), z.any()),
});

const isBrowser = typeof navigator !== 'undefined';
const isMac = isBrowser && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const CMD_KEY = isMac ? 'Cmd' : 'Ctrl';

export const DEFAULT_LEADER_KEY = `${CMD_KEY}+O`;

export const DEFAULT_KEYBOARD_SHORTCUTS: Record<string, string> = {
  submit: `${CMD_KEY}+Enter`,
  abort: 'Escape',
  toggleMode: 'T',
  undo: 'Z',
  redo: 'Shift+Z',
  compact: 'K',
  fork: 'F',
  settings: ',',
  sessions: 'S',
  newSession: 'N',
  closeSession: 'W',
  toggleSidebar: 'B',
  selectModel: 'M',
  variantCycle: `${CMD_KEY}+T`,
};

export const GitCredentialSchema = z.object({
  name: z.string(),
  host: z.string(),
  token: z.string(),
  username: z.string().optional(),
});

export type GitCredential = z.infer<typeof GitCredentialSchema>;

export const GitIdentitySchema = z.object({
  name: z.string(),
  email: z.string(),
});

export type GitIdentity = z.infer<typeof GitIdentitySchema>;

export const DEFAULT_GIT_IDENTITY: GitIdentity = {
  name: 'OpenCode Agent',
  email: '',
};

export const KubernetesConfigSchema = z.object({
  enabled: z.boolean(),
  namespace: z.string().optional(),
  kubeconfigPath: z.string().optional(),
});

export type KubernetesConfig = z.infer<typeof KubernetesConfigSchema>;

export const DEFAULT_KUBERNETES_CONFIG: KubernetesConfig = {
  enabled: false,
  namespace: 'opencode-manager',
};

export const UserPreferencesSchema = z.object({
  theme: z.enum(["dark", "light", "system"]),
  mode: z.enum(["plan", "build"]),
  defaultModel: z.string().optional(),
  defaultAgent: z.string().optional(),
  autoScroll: z.boolean(),
  showReasoning: z.boolean(),
  expandToolCalls: z.boolean(),
  expandDiffs: z.boolean(),
  leaderKey: z.string().optional(),
  directShortcuts: z.array(z.string()).optional(),
  keyboardShortcuts: z.record(z.string(), z.string()),
  customCommands: z.array(CustomCommandSchema),
  customAgents: z.array(CustomAgentSchema),
  gitCredentials: z.array(GitCredentialSchema).optional(),
  gitIdentity: GitIdentitySchema.optional(),
  kubernetesConfig: KubernetesConfigSchema.optional(),
  lastKnownGoodConfig: z.string().optional(),
  repoOrder: z.array(z.number()).optional(),
});

export const DEFAULT_USER_PREFERENCES = {
  theme: "dark" as const,
  mode: "build" as const,
  autoScroll: true,
  showReasoning: false,
  expandToolCalls: false,
  expandDiffs: true,
  leaderKey: DEFAULT_LEADER_KEY,
  directShortcuts: ['submit', 'abort'],
  keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
  customCommands: [],
  customAgents: [],
  gitCredentials: [] as GitCredential[],
  gitIdentity: DEFAULT_GIT_IDENTITY,
  kubernetesConfig: DEFAULT_KUBERNETES_CONFIG,
};

export const SettingsResponseSchema = z.object({
  preferences: UserPreferencesSchema,
  updatedAt: z.number(),
});

export const UpdateSettingsRequestSchema = z.object({
  preferences: UserPreferencesSchema.partial(),
});

export const OpenCodeConfigSchema = z.object({
  $schema: z.string().optional(),
  theme: z.string().optional(),
  model: z.string().optional(),
  small_model: z.string().optional(),
  provider: z.record(z.string(), z.any()).optional(),
  agent: z.record(z.string(), z.any()).optional(),
  command: z.record(z.string(), z.any()).optional(),
  keybinds: z.record(z.string(), z.any()).optional(),
  autoupdate: z.union([z.boolean(), z.literal("notify")]).optional(),
  formatter: z.record(z.string(), z.any()).optional(),
  permission: z.record(z.string(), z.any()).optional(),
  mcp: z.record(z.string(), z.any()).optional(),
  instructions: z.array(z.string()).optional(),
  disabled_providers: z.array(z.string()).optional(),
  share: z.enum(["manual", "auto", "disabled"]).optional(),
  plugin: z.array(z.string()).optional(),
});

export type OpenCodeConfigContent = z.infer<typeof OpenCodeConfigSchema>;

export const OpenCodeConfigMetadataSchema = z.object({
  id: z.number(),
  name: z.string().min(1).max(255),
  content: OpenCodeConfigSchema,
  isDefault: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const CreateOpenCodeConfigRequestSchema = z.object({
  name: z.string().min(1).max(255),
  content: z.union([OpenCodeConfigSchema, z.string()]),
  isDefault: z.boolean().optional(),
});

export const UpdateOpenCodeConfigRequestSchema = z.object({
  content: z.union([OpenCodeConfigSchema, z.string()]),
  isDefault: z.boolean().optional(),
});

export const OpenCodeConfigResponseSchema = z.object({
  configs: z.array(OpenCodeConfigMetadataSchema),
  defaultConfig: OpenCodeConfigMetadataSchema.nullable(),
});
