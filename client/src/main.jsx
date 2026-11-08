import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ParentApp from './parent/ParentApp.jsx';
import './styles.css';

const isParent = window.location.pathname.startsWith('/parent');
// Service worker: only used for grown-ups' phone notifications.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

createRoot(document.getElementById('root')).render(isParent ? <ParentApp /> : <App />);
