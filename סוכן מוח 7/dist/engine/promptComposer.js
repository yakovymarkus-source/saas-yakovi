"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.composePromptContext = composePromptContext;
function composePromptContext(input) {
    return JSON.stringify(input, null, 2);
}
