import React from 'react';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import './Docs.css';

const documentationContent = `
# Container MCP Server Documentation

Welcome to the official documentation for the **Container MCP Server** (\`@arxndev/container-mcp\`). This Model Context Protocol server allows AI assistants like Claude to securely manage, inspect, and orchestrate your local or remote containers (Docker/Apple Container CLI).

---

## 1. Installation & Configuration

### Prerequisites
- Node.js (v18 or newer)
- Docker Desktop, OrbStack, or Apple Container CLI installed locally.

### Claude Desktop Configuration
To add this to Claude Desktop, open your configuration file:
- **macOS:** \`~/Library/Application Support/Claude/claude_desktop_config.json\`
- **Windows:** \`%APPDATA%\\Claude\\claude_desktop_config.json\`

Add the following to the \`mcpServers\` object:

\`\`\`json
{
  "mcpServers": {
    "container-mcp": {
      "command": "npx",
      "args": ["-y", "@arxndev/container-mcp"]
    }
  }
}
\`\`\`

Restart Claude Desktop, and you will see a plug icon 🔌 indicating the tools are loaded.

---

## 2. Core Capabilities

The server registers 28 specialized tools broken down into 6 main categories:

### 🚀 Containers
Manage the lifecycle of your containers.
- \`run_container\`: Start new workloads securely.
- \`stop_container\` / \`start_container\` / \`remove_container\`: State management.
- \`exec_in_container\`: Execute commands securely inside a running container.

### 🔍 Diagnostics
Award-winning built-in AI diagnostics.
- \`diagnose_container\`: Automatically scans logs and inspects container state to determine *why* a container crashed (e.g. OOM, Port Conflict, Arch mismatch) and provides a suggested fix.
- \`explain_container\`: Provides a human-readable summary of a container's current configuration, top processes, and resource utilization.

### 📊 Logs & Metrics
Deep observability.
- \`get_logs\`: Fetch logs with tailing and since-timestamp filtering.
- \`get_container_stats\`: Live CPU, Memory, and Network metrics.
- \`get_container_processes\`: See exactly what is running inside the container (top).

### 💾 Volumes & Networks
Orchestrate the environment.
- \`create_volume\` / \`remove_volume\`
- \`create_network\` / \`connect_to_network\`

---

## 3. Security Architecture

Security is built directly into the core of this MCP server:

1. **Path Traversal Prevention:** Uses a robust \`isWithinSafeRoot\` trailing-slash normalization algorithm to completely prevent prefix-collision attacks when mounting volumes.
2. **Shell Injection Protection:** Does not use \`shell: true\`. All CLI arguments are passed safely as arrays directly to the executable via \`execa\`.
3. **Single-name Validation:** All single-parameter endpoints strictly validate against shell metacharacters (\`[\\s;|&\\$\`]\`).

---

## 4. Example Prompts for Claude

Try sending these prompts to Claude once the server is connected:

- *"What containers are currently running on my machine?"*
- *"Deploy an nginx container named 'web-proxy' on port 8080."*
- *"My 'database' container keeps crashing. Can you diagnose it for me?"*
- *"Tail the last 50 lines of logs for the 'api' container and tell me if there are any errors."*
- *"Prune my system to free up disk space, but please list what you're deleting first."*
`;

// Simple markdown renderer for docs
const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
  const parseMarkdown = (text: string) => {
    let html = text
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      .replace(/`(.*?)`/gim, '<code>$1</code>')
      .replace(/---/gim, '<hr/>');

    // Handle code blocks
    html = html.replace(/```json\n([\s\S]*?)```/gim, '<pre><code class="language-json">$1</code></pre>');
    
    // Handle bullet points
    html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
    html = html.replace(/<\/li>\n<li>/gim, '</li><li>');
    html = html.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');

    return { __html: html };
  };

  return <div className="markdown-body" dangerouslySetInnerHTML={parseMarkdown(content)} />;
};

export const Docs: React.FC = () => {
  return (
    <div className="page-wrapper">
      <Navbar />
      <main className="docs-main">
        <div className="container docs-container">
          <aside className="docs-sidebar glass-panel">
            <h4>Contents</h4>
            <ul>
              <li><a href="#1-installation--configuration">Installation</a></li>
              <li><a href="#2-core-capabilities">Capabilities</a></li>
              <li><a href="#3-security-architecture">Security</a></li>
              <li><a href="#4-example-prompts-for-claude">Examples</a></li>
            </ul>
          </aside>
          <article className="docs-content glass-panel">
            <MarkdownRenderer content={documentationContent} />
          </article>
        </div>
      </main>
      <Footer />
    </div>
  );
};
