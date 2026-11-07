import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ParentApp from './parent/ParentApp.jsx';
import './styles.css';

const isParent = window.location.pathname.startsWith('/parent');
createRoot(document.getElementById('root')).render(isParent ? <ParentApp /> : <App />);
