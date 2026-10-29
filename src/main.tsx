import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {PublicRecruitment} from './Recruitment';
import './style.css';
const entrance=location.pathname.match(/^\/baoming\/([^/]+)\/?$/);
createRoot(document.getElementById('root')!).render(entrance?<PublicRecruitment slot={entrance[1]}/>:<App/>);
