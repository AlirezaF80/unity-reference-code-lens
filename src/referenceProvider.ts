import * as vscode from 'vscode';
import { parseCSharpClasses, parseCSharpMethods } from './csharpParser';
import { getReferenceIndexService } from './referenceIndex';
import { methodRefsToLocations, scriptRefsToLocations } from './unityLocations';

/**
 * Feeds Unity prefab/scene hits into Go to References (Shift+F12).
 * VS Code merges these with C# language-server results.
 */
export class UnityReferenceProvider implements vscode.ReferenceProvider {
    public provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.ReferenceContext,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Location[]> {
        if (document.languageId !== 'csharp') {
            return [];
        }

        const indexService = getReferenceIndexService();
        const scriptGuid = indexService.getScriptGuid(document.fileName);
        if (!scriptGuid) {
            return [];
        }

        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return [];
        }

        const word = document.getText(wordRange);
        const content = document.getText();

        const methodOnThisLine = parseCSharpMethods(content).find(
            method => method.name === word && method.line === position.line
        );
        if (methodOnThisLine) {
            return methodRefsToLocations(
                indexService.getMethodReferences(scriptGuid, methodOnThisLine.name)
            );
        }

        const classMatch = parseCSharpClasses(content).find(cls => cls.name === word);
        if (classMatch) {
            return scriptRefsToLocations(indexService.getScriptReferences(scriptGuid));
        }

        const methodAnywhere = parseCSharpMethods(content).find(method => method.name === word);
        if (methodAnywhere) {
            return methodRefsToLocations(
                indexService.getMethodReferences(scriptGuid, methodAnywhere.name)
            );
        }

        return [];
    }
}
