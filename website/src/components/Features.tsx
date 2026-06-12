import React from 'react';
import { LayoutDashboard, Terminal, Activity, Shield, Cpu, RefreshCw } from 'lucide-react';
import './Features.css';

const features = [
  {
    icon: <LayoutDashboard size={24} />,
    title: 'Automated Diagnostics',
    description: 'AI instantly diagnoses crashed containers, analyzing OOM errors, port conflicts, and permissions issues.'
  },
  {
    icon: <Terminal size={24} />,
    title: 'Advanced Log Parsing',
    description: 'Stop grepping manually. Fetch parsed logs with dynamic tailing, timestamp filtering, and live views.'
  },
  {
    icon: <Activity size={24} />,
    title: 'Real-time Metrics',
    description: 'Get deep insights into memory usage, CPU load, block I/O, and live top processes inside any container.'
  },
  {
    icon: <RefreshCw size={24} />,
    title: 'Intelligent Orchestration',
    description: 'Let Claude deploy, build, and prune your environments automatically while maintaining zero-downtime safety.'
  },
  {
    icon: <Shield size={24} />,
    title: 'Built-in Security',
    description: 'Strict root-path validation, shell injection prevention, and safe directory mounting capabilities.'
  },
  {
    icon: <Cpu size={24} />,
    title: 'System Insights',
    description: 'Access complete Docker/Apple runtime info to resolve architecture mismatches and environment discrepancies.'
  }
];

export const Features: React.FC = () => {
  return (
    <section className="features">
      <div className="container">
        <div className="features-header">
          <h2 className="features-title">Unleash Your <span className="text-gradient">Containers</span></h2>
          <p className="features-subtitle">
            28 powerful tools specifically engineered to let AI models navigate and control your container ecosystem perfectly.
          </p>
        </div>
        
        <div className="features-grid">
          {features.map((feature, idx) => (
            <div key={idx} className="feature-card glass-panel">
              <div className="feature-icon">{feature.icon}</div>
              <h3 className="feature-card-title">{feature.title}</h3>
              <p className="feature-card-desc">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
