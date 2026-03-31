const fs = require('fs');
const path = require('path');
const util = require('util');

/**
 * Simple rotating logger that overrides console.log and console.error
 * @param {string} logFileName Name of the log file
 */
function setupLogger(logFileName) {
    const logPath = path.join(__dirname, logFileName);
    const maxLogSize = 5 * 1024 * 1024; // 5MB

    function rotateLog() {
        try {
            if (fs.existsSync(logPath)) {
                const stats = fs.statSync(logPath);
                if (stats.size > maxLogSize) {
                    const oldLogPath = logPath + '.old';
                    if (fs.existsSync(oldLogPath)) fs.unlinkSync(oldLogPath);
                    fs.renameSync(logPath, oldLogPath);
                }
            }
        } catch (err) {
            // Can't really log this to the file if it fails
            process.stderr.write(`Logger rotation failed: ${err.message}\n`);
        }
    }

    function writeToLog(type, args) {
        rotateLog();
        const timestamp = new Date().toISOString();
        const message = util.format.apply(util, args);
        const logEntry = `[${timestamp}] [${type}] ${message}\n`;
        try {
            fs.appendFileSync(logPath, logEntry);
        } catch (err) {
            process.stderr.write(`Failed to write to log file: ${err.message}\n`);
        }
    }

    const originalLog = console.log;
    const originalError = console.error;

    console.log = function() {
        writeToLog('INFO', arguments);
        originalLog.apply(console, arguments);
    };

    console.error = function() {
        writeToLog('ERROR', arguments);
        originalError.apply(console, arguments);
    };

    console.log(`[SYSTEM] File logging initialized: ${logPath}`);
}

module.exports = setupLogger;
