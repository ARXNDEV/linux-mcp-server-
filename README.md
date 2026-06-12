# container-mcp

[![npm version](https://img.shields.io/npm/v/container-mcp.svg)](https://www.npmjs.com/package/container-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-green.svg)](https://modelcontextprotocol.io)

**MCP server for Apple container** — manage, build, inspect, and diagnose Linux containers on macOS directly from AI agents like Claude Desktop, Claude Code, and Cursor.

Built on [Apple's container CLI](https://github.com/apple/container) for native Linux container support on Apple Silicon Macs.

---

## Prerequisites

- **macOS 26+** (Tahoe) on **Apple Silicon** (M1/M2/M3/M4)
- **Apple container CLI** installed — [github.com/apple/container](https://github.com/apple/container)
- **Node.js 18+**

## Installation

```bash
npm install -g container-mcp
```

Or run directly with npx:

```bash
npx container-mcp
```

## Configuration

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "container": {
      "command": "npx",
      "args": ["-y", "container-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add container-mcp -- npx -y container-mcp
```

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "container": {
      "command": "npx",
      "args": ["-y", "container-mcp"]
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTAINER_CLI_PATH` | `container` | Path to the container CLI binary |
| `CONTAINER_MCP_LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |

---

## Tool Reference

### 🐳 Container Lifecycle (8 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `list_containers` | List all containers | `all`, `format` |
| `run_container` | Create & run a new container | `image`, `name`, `ports`, `env`, `volumes`, `detach`, `command` |
| `stop_container` | Stop running containers | `names`, `timeout` |
| `start_container` | Start stopped containers | `names` |
| `delete_container` | Remove containers | `names`, `force` |
| `inspect_container` | Get detailed container info | `name` |
| `exec_in_container` | Execute command in container | `name`, `command`, `interactive` |
| `container_commit` | Commit container to new image | `container`, `image`, `message` |

### 📦 Image Management (5 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `list_images` | List local images | `format` |
| `pull_image` | Pull image from registry | `reference` |
| `build_image` | Build image from Dockerfile | `context`, `tag`, `dockerfile`, `buildArgs`, `platform` |
| `remove_image` | Remove images | `references`, `force` |
| `inspect_image` | Get detailed image info | `reference` |

### 📋 Logs & Monitoring (3 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `get_logs` | Get container logs | `name`, `tail`, `since` |
| `get_container_stats` | Get CPU/memory/network stats | `name` |
| `get_container_processes` | List processes in container | `name` |

### 💾 Volumes & Networks (4 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `list_volumes` | List all volumes | `format` |
| `create_volume` | Create a new volume | `name`, `size` |
| `delete_volume` | Remove volumes | `names`, `force` |
| `list_networks` | List all networks | `format` |

### ⚙️ System (2 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `system_info` | Get system info & version | — |
| `system_prune` | Remove all unused resources | `confirm` (must be `true`) |

### 🤖 AI-Powered Diagnostics (2 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `diagnose_container` | Analyze logs & state to diagnose issues | `name`, `question` |
| `explain_container` | Human-readable container summary | `name` |

---

## Example Prompts

Here are natural language prompts you can use with Claude or any MCP-compatible AI:

```
"List all my running containers"

"Run an nginx container named web-server on port 8080"

"Why is my database container crashing?"

"Show me the logs from the api container"

"Pull the latest Ubuntu image and run a container with it"

"What's the memory usage of all running containers?"

"Explain what the postgres container is doing"

"Build a Docker image from the current directory and tag it myapp:latest"

"Stop all containers and clean up unused images"

"Diagnose why the redis container keeps restarting"
```

---

## Development

### Setup

```bash
git clone https://github.com/your-org/container-mcp.git
cd container-mcp
npm install
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
npm run test:coverage
```

### Run locally

```bash
npm run dev
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Write code and tests
4. Ensure tests pass: `npm test`
5. Ensure the build works: `npm run build`
6. Submit a Pull Request

### Code Style

- TypeScript strict mode
- ESM modules
- Prettier + ESLint for formatting
- Zod schemas for all input validation
- JSDoc comments on all exported functions

---

## Architecture

```
container-mcp
├── MCP Server (stdio transport)
│   ├── Container Tools (8) ── container CLI
│   ├── Image Tools (5) ────── container CLI
│   ├── Log Tools (3) ──────── container CLI
│   ├── Volume Tools (3) ───── container CLI
│   ├── Network Tools (1) ──── container CLI
│   ├── System Tools (2) ───── container CLI
│   └── AI Tools (2) ──────── combines multiple CLI calls
│       ├── diagnose_container → logs + inspect → pattern analysis
│       └── explain_container  → inspect + stats + top → summary
└── Utilities
    ├── CLI Executor (execa, safe args)
    ├── Output Parsers (JSON, table)
    └── Logger (structured, stderr)
```

---

## License

[Apache-2.0](./LICENSE)
