import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import Subscribe from './Subscribe.jsx'

const path = window.location.pathname

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {path === '/subscribe' ? <Subscribe /> : <App />}
  </React.StrictMode>
)
