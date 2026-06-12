import React from 'react';
import './Footer.css';

export const Footer: React.FC = () => {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-content">
          <div className="footer-brand">
            ContainerMCP
          </div>
          <div className="footer-links">
            <a href="https://github.com/ARXNDEV/linux-mcp-server-" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://npmjs.com/package/@arxndev/container-mcp" target="_blank" rel="noreferrer">npm</a>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; {new Date().getFullYear()} Container MCP. Open Source.</p>
        </div>
      </div>
    </footer>
  );
};
