/**
 * Unity Reference CodeLens Provider
 * Shows reference counts on C# methods and classes
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { parseCSharpMethods, parseCSharpClasses } from './csharpParser';
import { getReferenceIndexService } from './referenceIndex';
import { MethodReference, ScriptReference } from './types';

export class UnityReferenceCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    constructor() {
        // Listen for index updates
        getReferenceIndexService().onIndexUpdated(() => {
            this._onDidChangeCodeLenses.fire();
        });

        // Listen for document changes
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.languageId === 'csharp') {
                this._onDidChangeCodeLenses.fire();
            }
        });
    }

    public provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeLens[]> {
        if (document.languageId !== 'csharp') {
            return [];
        }

        const indexService = getReferenceIndexService();
        
        // Get the GUID for this script
        const scriptGuid = indexService.getScriptGuid(document.fileName);
        
        if (!scriptGuid) {
            return [];
        }

        const content = document.getText();
        const codeLenses: vscode.CodeLens[] = [];

        // === CLASS REFERENCES ===
        const classes = parseCSharpClasses(content);
        const scriptReferences = indexService.getScriptReferences(scriptGuid);

        for (const cls of classes) {
            if (scriptReferences.length > 0) {
                const range = new vscode.Range(
                    cls.line,
                    cls.startChar,
                    cls.line,
                    cls.endChar
                );

                const codeLens = new vscode.CodeLens(range);
                codeLens.command = {
                    title: this.formatScriptTitle(scriptReferences),
                    command: 'unity-reference-code-lens.showScriptReferences',
                    arguments: [scriptReferences, cls.name]
                };

                codeLenses.push(codeLens);
            }
        }

        // === METHOD REFERENCES ===
        const methods = parseCSharpMethods(content);
        const allReferences = indexService.getAllMethodReferencesForScript(scriptGuid);

        for (const method of methods) {
            const references = allReferences.get(method.name) || [];
            
            if (references.length > 0) {
                const range = new vscode.Range(
                    method.line,
                    method.startChar,
                    method.line,
                    method.endChar
                );

                // Create the CodeLens
                const codeLens = new vscode.CodeLens(range);
                
                // Add command with reference info
                codeLens.command = {
                    title: this.formatTitle(references),
                    command: 'unity-reference-code-lens.showReferences',
                    arguments: [references, method.name]
                };

                codeLenses.push(codeLens);
            }
        }

        return codeLenses;
    }

    /**
     * Format the CodeLens title based on references
     */
    private formatTitle(references: MethodReference[]): string {
        const config = vscode.workspace.getConfiguration('unityReferenceLens');
        const showDetailed = config.get<boolean>('showDetailedInfo', true);
        const maxInline = config.get<number>('maxInlineReferences', 3);

        if (!showDetailed || references.length === 0) {
            return `${references.length} Unity reference${references.length !== 1 ? 's' : ''}`;
        }

        // Group by file
        const byFile = new Map<string, MethodReference[]>();
        for (const ref of references) {
            const existing = byFile.get(ref.fileName) || [];
            existing.push(ref);
            byFile.set(ref.fileName, existing);
        }

        const fileNames = Array.from(byFile.keys());
        
        if (fileNames.length <= maxInline) {
            // Show all file names
            return fileNames.join(' | ');
        } else {
            // Show first few and count
            const shown = fileNames.slice(0, maxInline);
            const remaining = fileNames.length - maxInline;
            return `${shown.join(' | ')} (+${remaining} more)`;
        }
    }

    /**
     * Format the CodeLens title for script references
     */
    private formatScriptTitle(references: ScriptReference[]): string {
        const sceneCount = references.filter(r => r.fileType === 'scene').length;
        const prefabCount = references.filter(r => r.fileType === 'prefab').length;
        const variantCount = references.filter(r => r.fileType === 'variant').length;
        
        const parts: string[] = [];
        if (sceneCount > 0) parts.push(`${sceneCount} scene${sceneCount !== 1 ? 's' : ''}`);
        if (prefabCount > 0) parts.push(`${prefabCount} prefab${prefabCount !== 1 ? 's' : ''}`);
        if (variantCount > 0) parts.push(`${variantCount} variant${variantCount !== 1 ? 's' : ''}`);
        
        return `Used in ${parts.join(', ')}`;
    }

    public resolveCodeLens(
        codeLens: vscode.CodeLens,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeLens> {
        // CodeLens is already resolved in provideCodeLenses
        return codeLens;
    }

    public refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    public dispose(): void {
        this._onDidChangeCodeLenses.dispose();
    }
}

/**
 * Show references in a QuickPick or panel
 */
export async function showReferencesCommand(
    references: MethodReference[],
    methodName: string
): Promise<void> {
    if (references.length === 0) {
        vscode.window.showInformationMessage(`No Unity references found for ${methodName}`);
        return;
    }

    // Create QuickPick items with detailed information
    interface ReferenceQuickPickItem extends vscode.QuickPickItem {
        reference: MethodReference;
    }

    const items: ReferenceQuickPickItem[] = references.map(ref => {
        // Build label with file and GameObject info, include file type icon
        const fileTypeIcon = ref.fileType === 'scene' ? '$(file)' : 
                            ref.fileType === 'variant' ? '$(git-branch)' : '$(package)';
        const label = ref.gameObjectName 
            ? `${fileTypeIcon} ${ref.fileName} → ${ref.gameObjectName}`
            : `${fileTypeIcon} ${ref.fileName}`;
        
        // Description with hierarchy path
        const description = ref.hierarchyPath && ref.hierarchyPath !== ref.gameObjectName
            ? ref.hierarchyPath
            : undefined;
        
        // Detail with component type, line number, and file type
        const componentInfo = ref.componentName ? `[${ref.componentName}]` : '';
        const lineInfo = ref.lineNumber ? `Line ${ref.lineNumber}` : '';
        const typeInfo = ref.fileType === 'variant' ? 'Variant' : ref.fileType === 'scene' ? 'Scene' : 'Prefab';
        const detail = [componentInfo, ref.referenceType, typeInfo, lineInfo].filter(Boolean).join(' • ');

        return {
            label,
            description,
            detail,
            reference: ref
        };
    });

    // Sort items: scenes first, then prefabs, then variants, then by file name
    items.sort((a, b) => {
        const typeOrder = { scene: 0, prefab: 1, variant: 2 };
        const aOrder = typeOrder[a.reference.fileType];
        const bOrder = typeOrder[b.reference.fileType];
        
        if (aOrder !== bOrder) {
            return aOrder - bOrder;
        }
        // Then by file name
        const fileCompare = a.reference.fileName.localeCompare(b.reference.fileName);
        if (fileCompare !== 0) return fileCompare;
        // Then by hierarchy path
        return (a.reference.hierarchyPath || '').localeCompare(b.reference.hierarchyPath || '');
    });

    const selected = await vscode.window.showQuickPick(items, {
        title: `Unity References: ${methodName}()`,
        placeHolder: `Found ${references.length} reference${references.length !== 1 ? 's' : ''} - Click to open location`,
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (selected) {
        // Open the Unity file at the reference location
        const uri = vscode.Uri.file(selected.reference.filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);

        if (selected.reference.lineNumber) {
            const line = selected.reference.lineNumber - 1;
            const range = new vscode.Range(line, 0, line, 0);
            editor.selection = new vscode.Selection(range.start, range.start);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            
            // Highlight the line briefly
            const decoration = vscode.window.createTextEditorDecorationType({
                backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
                isWholeLine: true
            });
            editor.setDecorations(decoration, [range]);
            
            // Remove highlight after 2 seconds
            setTimeout(() => decoration.dispose(), 2000);
        }
    }
}

/**
 * Show script references in a QuickPick
 */
export async function showScriptReferencesCommand(
    references: ScriptReference[],
    className: string
): Promise<void> {
    if (references.length === 0) {
        vscode.window.showInformationMessage(`No Unity references found for class ${className}`);
        return;
    }

    interface ScriptRefQuickPickItem extends vscode.QuickPickItem {
        reference: ScriptReference;
    }

    const items: ScriptRefQuickPickItem[] = references.map(ref => {
        const fileTypeIcon = ref.fileType === 'scene' ? '$(file)' : 
                            ref.fileType === 'variant' ? '$(git-branch)' : '$(package)';
        const label = ref.gameObjectName 
            ? `${fileTypeIcon} ${ref.fileName} → ${ref.gameObjectName}`
            : `${fileTypeIcon} ${ref.fileName}`;
        
        const description = ref.hierarchyPath && ref.hierarchyPath !== ref.gameObjectName
            ? ref.hierarchyPath
            : undefined;
        
        const typeLabel = ref.fileType === 'scene' ? 'Scene' : 
                         ref.fileType === 'variant' ? 'Prefab Variant' : 'Prefab';
        const detail = `${typeLabel}${ref.lineNumber ? ` • Line ${ref.lineNumber}` : ''}`;

        return {
            label,
            description,
            detail,
            reference: ref
        };
    });

    // Sort: scenes first, then prefabs, then variants
    items.sort((a, b) => {
        const typeOrder = { scene: 0, prefab: 1, variant: 2 };
        const aOrder = typeOrder[a.reference.fileType];
        const bOrder = typeOrder[b.reference.fileType];
        
        if (aOrder !== bOrder) {
            return aOrder - bOrder;
        }
        return a.reference.fileName.localeCompare(b.reference.fileName);
    });

    const selected = await vscode.window.showQuickPick(items, {
        title: `Unity References: ${className}`,
        placeHolder: `Found ${references.length} usage${references.length !== 1 ? 's' : ''} - Click to open location`,
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (selected) {
        const uri = vscode.Uri.file(selected.reference.filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);

        if (selected.reference.lineNumber) {
            const line = selected.reference.lineNumber - 1;
            const range = new vscode.Range(line, 0, line, 0);
            editor.selection = new vscode.Selection(range.start, range.start);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            
            const decoration = vscode.window.createTextEditorDecorationType({
                backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
                isWholeLine: true
            });
            editor.setDecorations(decoration, [range]);
            setTimeout(() => decoration.dispose(), 2000);
        }
    }
}
