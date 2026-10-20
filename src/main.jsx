import { createRoot } from 'react-dom/client'
import { useState, useEffect } from 'react'
import './index.css'
import RatioSpreadScanner from './RatioSpreadScanner.jsx'
import { AppDialogHost } from './components/common/AppDialog.jsx'

function Root() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  return (
    <>
      <RatioSpreadScanner
        onNavigate={() => {}}
        theme={theme}
        toggleTheme={toggleTheme}
      />
      <AppDialogHost />
    </>
  );
}

createRoot(document.getElementById('root')).render(<Root />)
