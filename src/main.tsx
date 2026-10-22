import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {PublicRecruitment} from './Recruitment';
import './style.css';
createRoot(document.getElementById('root')!).render(/^\/[a-e]\/?$/.test(location.pathname)?<PublicRecruitment slot={location.pathname[1]}/>:<App/>);
