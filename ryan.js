/**
 * ryan.js - Command Registry for JAILBREAK AI
 * This file handles the registration and storage of commands.
 * The execution logic is handled by the primary socket.js handler.
 */

var commands = [];

/**
 * Register a command or button handler.
 * @param {Object} info - Command info (pattern, alias, desc, category, etc.)
 * @param {Function} func - The actual function to run when command is triggered.
 */
function JB(info, func) {
    const data = { 
        ...info, 
        function: func 
    };

    // Set default values for metadata
    if (data.dontAddCommandList === undefined) data.dontAddCommandList = false;
    if (data.desc === undefined) data.desc = '';
    if (data.fromMe === undefined) data.fromMe = false;
    if (data.category === undefined) data.category = 'misc';
    if (data.filename === undefined) data.filename = "Not Provided";
    
    // Check if command already exists to prevent duplicates during hot-reloads
    const index = commands.findIndex(c => c.pattern === data.pattern);
    if (index !== -1) {
        commands[index] = data;
    } else {
        commands.push(data);
    }
    
    return data;
}

module.exports = {
    JB,
    AddCommand: JB,
    Function: JB,
    Module: JB,
    commands // This is exported so socket.js can iterate through registered commands
};