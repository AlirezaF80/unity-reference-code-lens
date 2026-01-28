/**
 * Unity Reference CodeLens Extension
 * Shows Unity references (prefabs, scenes, buttons) on C# methods
 */

import * as vscode from 'vscode';
import { UnityReferenceCodeLensProvider, showReferencesCommand } from './codeLensProvider';
import { getReferenceIndexService, disposeReferenceIndexService } from './referenceIndex';

let codeLensProvider: UnityReferenceCodeLensProvider | undefined;

export async function activate(context: vscode.ExtensionContext) {
    // Register CodeLens provider for C# files
    codeLensProvider = new UnityReferenceCodeLensProvider();
    const codeLensRegistration = vscode.languages.registerCodeLensProvider(
        { language: 'csharp', scheme: 'file' },
        codeLensProvider
    );
    context.subscriptions.push(codeLensRegistration);

    // Register command to show references
    const showReferencesCmd = vscode.commands.registerCommand(
        'unity-reference-code-lens.showReferences',
        showReferencesCommand
    );
    context.subscriptions.push(showReferencesCmd);

    // Register command to rebuild index
    const rebuildIndexCmd = vscode.commands.registerCommand(
        'unity-reference-code-lens.rebuildIndex',
        async () => {
            await buildIndexWithProgress();
        }
    );
    context.subscriptions.push(rebuildIndexCmd);

    // Register command to show index status
    const showStatusCmd = vscode.commands.registerCommand(
        'unity-reference-code-lens.showStatus',
        () => {
            const indexService = getReferenceIndexService();
            const refCount = indexService.getTotalReferenceCount();
            const isBuilt = indexService.isIndexBuilt();
            
            vscode.window.showInformationMessage(
                `Unity Reference Index: ${isBuilt ? 'Built' : 'Not built'} | ${refCount} references found`
            );
        }
    );
    context.subscriptions.push(showStatusCmd);

    // Build index on activation
    await buildIndexWithProgress();

    // Show status bar item
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.text = '$(references) Unity Refs';
    statusBarItem.tooltip = 'Unity Reference CodeLens - Click to rebuild index';
    statusBarItem.command = 'unity-reference-code-lens.rebuildIndex';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
}

async function buildIndexWithProgress(): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Unity Reference CodeLens',
            cancellable: false
        },
        async (progress) => {
            const indexService = getReferenceIndexService();
            await indexService.buildIndex(progress);
            
            // Refresh CodeLens
            codeLensProvider?.refresh();
        }
    );
}

export function deactivate() {
    codeLensProvider?.dispose();
    disposeReferenceIndexService();
}
