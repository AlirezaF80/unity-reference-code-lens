import * as vscode from 'vscode';
import { MethodReference, ScriptReference } from './types';

export function methodRefsToLocations(references: MethodReference[]): vscode.Location[] {
    return references.map(ref => toLocation(ref.filePath, ref.lineNumber));
}

export function scriptRefsToLocations(references: ScriptReference[]): vscode.Location[] {
    return references.map(ref => toLocation(ref.filePath, ref.lineNumber));
}

function toLocation(filePath: string, lineNumber?: number): vscode.Location {
    const line = Math.max(0, (lineNumber ?? 1) - 1);
    return new vscode.Location(
        vscode.Uri.file(filePath),
        new vscode.Position(line, 0)
    );
}
