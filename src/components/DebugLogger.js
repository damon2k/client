import React, { useEffect, useRef } from 'react';
import { Terminal, X } from 'lucide-react';

const DebugLogger = ({ logs, isVisible, onClose }) => {
  const logRef = useRef(null);
  
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);
  
  if (!isVisible) return null;
  
  const getLogColor = (type) => {
    switch (type) {
      case 'error': return '#ef4444';
      case 'success': return '#10b981';
      case 'warning': return '#f59e0b';
      default: return '#10b981';
    }
  };
  
  return (
    <div className="debug-logger">
      <div className="debug-header">
        <div className="debug-title">
          <Terminal className="debug-icon" />
          Debug Console
        </div>
        {onClose && (
          <button onClick={onClose} className="debug-close">
            <X className="close-icon" />
          </button>
        )}
      </div>
      
      <div ref={logRef} className="debug-content">
        {logs.length === 0 ? (
          <div className="debug-empty">No logs yet...</div>
        ) : (
          logs.map((log, index) => (
            <div key={index} className="debug-log-entry">
              <span className="debug-timestamp">[{log.timestamp}]</span>
              <span 
                className="debug-message"
                style={{ color: getLogColor(log.type) }}
              >
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
      
      <div className="debug-footer">
        <span className="debug-count">{logs.length} logs</span>
      </div>
    </div>
  );
};

export default DebugLogger;