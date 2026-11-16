import '@fontsource-variable/nunito-sans';
import './index.css';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { installHardwareH264Preference } from './lib/h264.ts';

installHardwareH264Preference();
createRoot(document.getElementById('root')!).render(<App />);
