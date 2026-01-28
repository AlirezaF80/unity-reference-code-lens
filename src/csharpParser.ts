/**
 * C# Method Parser
 * Parses C# files to extract method declarations with their positions
 */

import { CSharpMethod, CSharpClass } from './types';

/**
 * Parse a C# file content and extract all method declarations
 * @param content The content of the C# file
 * @returns Array of parsed methods with their positions
 */
export function parseCSharpMethods(content: string): CSharpMethod[] {
    const methods: CSharpMethod[] = [];
    const lines = content.split('\n');

    // Regex to match method declarations
    // Matches: [access] [static] [async] [virtual/override/abstract] returnType methodName(params)
    const methodRegex = /^(\s*)(public|private|protected|internal)?\s*(static\s+)?(async\s+)?(virtual\s+|override\s+|abstract\s+)?(\w+(?:<[^>]+>)?(?:\[\])?)\s+(\w+)\s*\(/;

    // Keywords that indicate it's not a method (it's a control structure or class/struct)
    const notMethodKeywords = ['if', 'else', 'for', 'foreach', 'while', 'do', 'switch', 'try', 'catch', 'finally', 'using', 'lock', 'class', 'struct', 'interface', 'enum', 'namespace', 'new', 'return', 'throw', 'yield'];

    // Return types that indicate it's a method
    const validReturnTypes = ['void', 'bool', 'int', 'float', 'double', 'string', 'char', 'byte', 'short', 'long', 'decimal', 'object', 'dynamic', 'var'];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(methodRegex);

        if (match) {
            const accessModifier = match[2] as CSharpMethod['accessModifier'] || '';
            const returnType = match[6];
            const methodName = match[7];

            // Skip if methodName is a keyword
            if (notMethodKeywords.includes(methodName.toLowerCase())) {
                continue;
            }

            // Skip constructors (method name same as return type suggests class definition)
            // But allow if it looks like a valid return type
            if (returnType === methodName) {
                continue;
            }

            // Skip if it's likely a property or field (check for { get; set; } pattern)
            const restOfLine = line.substring(match[0].length - 1); // Get the part after method name(
            if (restOfLine.includes('=>') && !restOfLine.includes('{')) {
                // Expression-bodied property, skip
                // Actually, expression-bodied methods are valid, so don't skip
            }

            // Find the end of method signature (closing parenthesis)
            let signature = match[0];
            let parenCount = 1;
            let charPos = match[0].length;

            // Continue reading to find the closing parenthesis
            for (let j = charPos; j < line.length && parenCount > 0; j++) {
                if (line[j] === '(') parenCount++;
                if (line[j] === ')') parenCount--;
                signature += line[j];
                charPos = j + 1;
            }

            // Skip if followed by "where" (generic constraint) or doesn't have body
            const afterSignature = line.substring(charPos).trim();
            if (afterSignature.startsWith('where')) {
                // It's a generic method, still valid
            }

            // Check if it's actually a method (has body { or ; for abstract/interface)
            let hasBody = afterSignature.includes('{') || afterSignature.includes('=>') || afterSignature === '' || afterSignature === ';';
            
            if (!hasBody) {
                // Check next line
                if (i + 1 < lines.length) {
                    const nextLine = lines[i + 1].trim();
                    hasBody = nextLine.startsWith('{') || nextLine.startsWith('=>');
                }
            }

            if (hasBody || afterSignature === ';') {
                const startChar = match[1].length; // Indentation length
                const endChar = startChar + signature.length - match[1].length;

                methods.push({
                    name: methodName,
                    line: i,
                    startChar,
                    endChar,
                    signature: signature.trim(),
                    accessModifier
                });
            }
        }
    }

    return methods;
}

/**
 * Find a specific method by name and return its position
 * @param content The content of the C# file
 * @param methodName The method name to find
 * @returns The method info or undefined if not found
 */
export function findMethodByName(content: string, methodName: string): CSharpMethod | undefined {
    const methods = parseCSharpMethods(content);
    return methods.find(m => m.name === methodName);
}

/**
 * Get all public methods that could be called by Unity events
 * @param content The content of the C# file
 * @returns Array of public methods
 */
export function getUnityCallableMethods(content: string): CSharpMethod[] {
    const methods = parseCSharpMethods(content);
    // Unity can call public and private methods via SendMessage/Invoke
    // But UnityEvents typically call public methods
    return methods.filter(m => m.accessModifier === 'public' || m.accessModifier === '');
}

/**
 * Parse a C# file content and extract class declarations
 * @param content The content of the C# file
 * @returns Array of parsed classes with their positions
 */
export function parseCSharpClasses(content: string): CSharpClass[] {
    const classes: CSharpClass[] = [];
    const lines = content.split('\n');

    // Regex to match class declarations
    // Matches: [access] [partial] [abstract/sealed] class ClassName [: BaseClass, IInterface]
    const classRegex = /^(\s*)(public|private|protected|internal)?\s*(partial\s+)?(abstract\s+|sealed\s+)?class\s+(\w+)(?:<[^>]+>)?(?:\s*:\s*(.+?))?(?:\s*\{|\s*$)/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(classRegex);

        if (match) {
            const accessModifier = (match[2] as CSharpClass['accessModifier']) || '';
            const className = match[5];
            const baseTypesStr = match[6];

            const startChar = match[1].length;
            const endChar = line.length;

            // Parse base types
            let baseTypes: string[] | undefined;
            if (baseTypesStr) {
                baseTypes = baseTypesStr.split(',').map(t => t.trim()).filter(t => t);
            }

            classes.push({
                name: className,
                line: i,
                startChar,
                endChar,
                accessModifier,
                baseTypes
            });
        }
    }

    return classes;
}
