import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/cyrillic-400.css';
import '@fontsource/ibm-plex-sans/cyrillic-500.css';
import '@fontsource/ibm-plex-sans/cyrillic-600.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/cormorant-garamond/cyrillic-600.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '../shared/styles/tokens.css';
import '../shared/styles/base.css';
import './layout.css';
import './workbench.css';
import favicon from '../shared/assets/laterna-micro.svg?inline';
import { App } from './App';

const icon = document.createElement('link');
icon.rel = 'icon';
icon.type = 'image/svg+xml';
icon.href = favicon;
document.head.append(icon);

createRoot(document.getElementById('root')!).render(<App/>);
