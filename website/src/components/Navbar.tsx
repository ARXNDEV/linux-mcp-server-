import React from 'react';
import { Link } from 'react-router-dom';
import { Box, Terminal } from 'lucide-react';
import './Navbar.css';

export const Navbar: React.FC = () => {
  return (
    <nav className="navbar glass-panel">
      <div className="navbar-content">
        <Link to="/" className="navbar-brand">
          <Box className="brand-icon" size={24} />
          <span className="brand-text">Container<span className="text-muted">MCP</span></span>
        </Link>
        
        <div className="navbar-links">
          <Link to="/docs" className="nav-link">Documentation</Link>
          <a href="https://github.com/ARXNDEV/linux-mcp-server-" target="_blank" rel="noreferrer" className="nav-link icon-link">
            <Terminal size={20} />
            <span>GitHub</span>
          </a>
        </div>
      </div>
    </nav>
  );
};
