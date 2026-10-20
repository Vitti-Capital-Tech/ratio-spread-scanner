import React from 'react';
import { TrendingUp, Target, Sun, Moon } from 'lucide-react';

export default function Navbar({
  activeTab,
  onNavigate,
  theme,
  toggleTheme,
  badgeLabel,
  badgeColor,
  badgeDotClassName,
  extraHeaderContent
}) {
  return (
    <>
      <nav className="navbar">
        <div className="logo" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <TrendingUp size={26} color="#00d9a3" style={{ flexShrink: 0 }} />
          <span className="logo-text">VITTI RATIO <span style={{ color: 'var(--accent)' }}>SPREAD</span></span>
        </div>

        <div className="nav-tabs-container">
          <button
            className={`nav-tab ${activeTab === 'scanner' ? 'active' : ''}`}
            onClick={() => onNavigate('scanner')}
          >
            <span className="nav-tab-icon" aria-hidden="true">
              <Target size={14} />
            </span> <span className="nav-tab-text">Ratio Spread</span>
          </button>
        </div>

        <div className="nav-actions-container">
          {extraHeaderContent}
          <button className="nav-tab" onClick={toggleTheme} title="Toggle Theme" style={{ padding: '6px' }}>
            {theme === 'dark' ? (
              <Sun size={16} />
            ) : (
              <Moon size={16} />
            )}
          </button>
          <div className="ws-badge">
            <div className={`ws-dot ${badgeDotClassName || ''}`} style={badgeColor ? { background: badgeColor } : undefined} />
            <span>{badgeLabel}</span>
          </div>
        </div>
      </nav>

      <div className="mobile-bottom-nav">
        <button
          className={`mobile-bottom-tab ${activeTab === 'scanner' ? 'active' : ''}`}
          onClick={() => onNavigate('scanner')}
        >
          <span className="mobile-bottom-icon">
            <Target size={18} />
          </span>
          <span className="mobile-bottom-text">Ratio Spread</span>
        </button>
      </div>
    </>
  );
}
