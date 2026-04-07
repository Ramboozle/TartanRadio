/**
 * Tartan Radio - Log Management System
 * 
 * This utility provides a simple file-based logging mechanism that automatically
 * captures all output from 'console.log' and 'console.error'. It features log rotation
 * to ensure log files do not consume excessive disk space on small systems like 
 * Raspberry Pis.
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

/**
 * setupLogger
 * Main entry point to initialize file logging.
 * It hijacks the global console object to redirect output to a file.
 * 
 * @param {string} logFileName The name of the file (e.g., 'server.log')
 */
function setupLogger(logFileName) {
    // Determine absolute path for the log file
    const logPath = path.join(__dirname, logFileName);
    
    /**
     * LIMIT: 5MB
     * When the log file exceeds this size, it is archived to .old and a new one starts.
     */
    const maxLogSize = 5 * 1024 * 1024; // 5MB

    /**
     * rotateLog
     * Internal function to check file size and perform rotation.
     * If the current file is too large, it is renamed to '.old'.
     * If an existing '.old' file exists, it is deleted first.
     */
    function rotateLog() {
        try {
            if (fs.existsSync(logPath)) {
                const stats = fs.statSync(logPath);
                if (stats.size > maxLogSize) {
                    const oldLogPath = logPath + '.old';
                    // Clear previous archive
                    if (fs.existsSync(oldLogPath)) fs.unlinkSync(oldLogPath);
                    // Move current log to archive
                    fs.renameSync(logPath, oldLogPath);
                }
            }
        } catch (err) {
            // Write directly to stderr if rotation fails (since we can't use console.log here safely)
            process.stderr.write(`Logger rotation failed: ${err.message}\n`);
        }
    }

    /**
     * writeToLog
     * Formats a log entry and appends it to the file.
     * 
     * @param {string} type 'INFO' or 'ERROR'
     * @param {IArguments} args The arguments passed to console.log/error
     */
    function writeToLog(type, args) {
        rotateLog(); // Always check size before writing
        
        const timestamp = new Date().toISOString();
        // Use Node's internal formatter to handle objects/formatting strings (like %s, %j)
        const message = util.format.apply(util, args);
        
        // Assemble final log line: [Timestamp] [Level] Message
        const logEntry = `[${timestamp}] [${type}] ${message}\n`;
        
        try {
            // Atomic append operation
            fs.appendFileSync(logPath, logEntry);
        } catch (err) {
            process.stderr.write(`Failed to write to log file: ${err.message}\n`);
        }
    }

    // Capture references to the original console functions before we overwrite them
    const originalLog = console.log;
    const originalError = console.error;

    /**
     * CONSOLE OVERRIDE: log
     * Captures standard informational output.
     */
    console.log = function() {
        writeToLog('INFO', arguments); // Save to file
        originalLog.apply(console, arguments); // Still print to terminal
    };

    /**
     * CONSOLE OVERRIDE: error
     * Captures critical error output.
     */
    console.error = function() {
        writeToLog('ERROR', arguments); // Save to file
        originalError.apply(console, arguments); // Still print to terminal (usually red in color)
    };

    console.log(`[SYSTEM] File logging initialized: ${logPath}`);
}

module.exports = setupLogger;

