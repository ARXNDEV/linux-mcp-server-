import React from 'react';
import { Terminal, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import './Hero.css';

export const Hero: React.FC = () => {
  return (
    <section className="hero">
      <div className="bg-glow" style={{ top: '10%', left: '20%' }}></div>
      <div className="container hero-container">
        <div className="hero-content">
          <div className="badge glass-panel">
            <span className="badge-dot"></span>
            v0.1.0 Now Available on npm
          </div>
          <h1 className="hero-title">
            Seamlessly Manage Containers with <br/>
            <span className="text-gradient-accent">AI & MCP</span>
          </h1>
          <p className="hero-subtitle">
            The intelligent, zero-friction layer for managing and orchestrating Docker workloads via Model Context Protocol on macOS.
          </p>
          <div className="hero-actions">
            <Link to="/docs" className="btn-primary">
              Read Documentation <ArrowRight size={18} />
            </Link>
            <a href="https://github.com/ARXNDEV/linux-mcp-server-" className="btn-secondary" target="_blank" rel="noreferrer">
              <Terminal size={18} /> View Source
            </a>
          </div>
        </div>
        
        <div className="hero-visual">
          <div className="terminal-window glass-panel">
            <div className="terminal-header">
              <div className="terminal-dots">
                <span></span><span></span><span></span>
              </div>
              <div className="terminal-title">claude-desktop ~ container-mcp</div>
            </div>
            <div className="terminal-body">
              <div className="term-line">
                <span className="term-prompt">❯</span> npx @arxndev/container-mcp
              </div>
              <div className="term-line output success">
                [INFO] Starting container-mcp server v0.1.0
              </div>
              <div className="term-line output success">
                [INFO] Container CLI found
              </div>
              <div className="term-line output success">
                [INFO] All 28 tools registered successfully
              </div>
              <div className="term-line output success">
                [INFO] container-mcp server running on stdio transport
              </div>
              <div className="term-line mt-2">
                <span className="term-prompt">AI</span> Let's diagnose the crash in the "web" container.
              </div>
              <div className="term-line mt-2">
                <span className="term-system">Calling tool: diagnose_container(name="web")</span>
              </div>
              <div className="term-line output error">
                [WARN] container web exited with code 137
              </div>
              <div className="term-line output highlight mt-1">
                → Memory limit exceeded (OOM)
              </div>
              <div className="term-line output">
                → Fix: Increase container memory limit using -m or --memory flags.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
