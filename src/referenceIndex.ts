/**
 * Reference Index Service
 * Builds and maintains an index of all Unity method references
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MethodReference, UnityFileCache, ReferenceIndex } from './types';
import { parseUnityFile, extractGuidFromMeta } from './unityParser';

export class ReferenceIndexService {
    private index: ReferenceIndex = new Map();
    private fileCache: Map<string, UnityFileCache> = new Map();
    private scriptGuidMap: Map<string, string> = new Map(); // scriptPath -> guid
    private guidToScriptPath: Map<string, string> = new Map(); // guid -> scriptPath
    private isIndexing = false;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private _onIndexUpdated = new vscode.EventEmitter<void>();
    public readonly onIndexUpdated = this._onIndexUpdated.event;
    private unityProjectRoots: Set<string> = new Set(); // Track Unity project roots

    constructor() {
        this.setupFileWatcher();
    }

    /**
     * Find Unity project root from a file path (looks for Assets folder)
     */
    private findUnityProjectRoot(filePath: string): string | undefined {
        let currentDir = path.dirname(filePath);
        
        // Walk up the directory tree looking for Assets folder
        while (currentDir && currentDir !== path.dirname(currentDir)) {
            const assetsPath = path.join(currentDir, 'Assets');
            if (fs.existsSync(assetsPath) && fs.statSync(assetsPath).isDirectory()) {
                // Check if this looks like a Unity project (has ProjectSettings or Library)
                const projectSettings = path.join(currentDir, 'ProjectSettings');
                const library = path.join(currentDir, 'Library');
                if (fs.existsSync(projectSettings) || fs.existsSync(library)) {
                    return currentDir;
                }
            }
            currentDir = path.dirname(currentDir);
        }
        return undefined;
    }

    /**
     * Initialize the index by scanning all Unity files
     */
    public async buildIndex(progress?: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
        if (this.isIndexing) {
            return;
        }

        this.isIndexing = true;
        this.index.clear();
        this.fileCache.clear();

        try {
            // First, detect Unity project roots from open editors and workspace
            await this.detectUnityProjects();
            
            // Build the script GUID map
            progress?.report({ message: 'Scanning .meta files...', increment: 0 });
            await this.buildScriptGuidMap();

            // Find all Unity files from detected project roots
            progress?.report({ message: 'Finding Unity files...', increment: 10 });
            const unityFiles = await this.findUnityFiles();
            
            console.log(`[UnityRefLens] Found ${unityFiles.length} Unity files to index`);
            
            const totalFiles = unityFiles.length;
            let processed = 0;

            for (const filePath of unityFiles) {
                progress?.report({
                    message: `Parsing ${path.basename(filePath)}...`,
                    increment: totalFiles > 0 ? (80 / totalFiles) : 0
                });

                await this.indexFile(filePath);
                processed++;
            }

            progress?.report({ message: 'Index complete!', increment: 10 });
            console.log(`[UnityRefLens] Indexed ${processed} files, found ${this.getTotalReferenceCount()} references`);
            
            this._onIndexUpdated.fire();
        } finally {
            this.isIndexing = false;
        }
    }

    /**
     * Detect Unity projects from open editors and workspace folders
     */
    private async detectUnityProjects(): Promise<void> {
        this.unityProjectRoots.clear();
        
        // Check all open text editors
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.fileName.endsWith('.cs')) {
                const projectRoot = this.findUnityProjectRoot(editor.document.fileName);
                if (projectRoot) {
                    this.unityProjectRoots.add(projectRoot);
                    console.log(`[UnityRefLens] Detected Unity project from editor: ${projectRoot}`);
                }
            }
        }
        
        // Also check workspace folders
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const assetsPath = path.join(folder.uri.fsPath, 'Assets');
                if (fs.existsSync(assetsPath)) {
                    this.unityProjectRoots.add(folder.uri.fsPath);
                    console.log(`[UnityRefLens] Detected Unity project from workspace: ${folder.uri.fsPath}`);
                }
            }
        }
        
        console.log(`[UnityRefLens] Total Unity projects detected: ${this.unityProjectRoots.size}`);
    }

    /**
     * Find all Unity files (.unity, .prefab) in detected project roots
     */
    private async findUnityFiles(): Promise<string[]> {
        const allFiles: string[] = [];
        
        for (const projectRoot of this.unityProjectRoots) {
            const assetsPath = path.join(projectRoot, 'Assets');
            if (fs.existsSync(assetsPath)) {
                await this.scanDirectoryForUnityFiles(assetsPath, allFiles);
            }
        }
        
        return allFiles;
    }

    /**
     * Recursively scan directory for .unity and .prefab files
     */
    private async scanDirectoryForUnityFiles(dir: string, results: string[]): Promise<void> {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    // Skip Library, Temp, etc.
                    if (!['Library', 'Temp', 'Logs', 'obj', 'Build', 'Builds'].includes(entry.name)) {
                        await this.scanDirectoryForUnityFiles(fullPath, results);
                    }
                } else if (entry.isFile()) {
                    if (entry.name.endsWith('.unity') || entry.name.endsWith('.prefab')) {
                        results.push(fullPath);
                    }
                }
            }
        } catch (error) {
            console.error(`[UnityRefLens] Error scanning ${dir}:`, error);
        }
    }

    /**
     * Build a map of script file paths to their GUIDs
     */
    private async buildScriptGuidMap(): Promise<void> {
        // Scan from Unity project roots instead of workspace
        for (const projectRoot of this.unityProjectRoots) {
            const assetsPath = path.join(projectRoot, 'Assets');
            if (fs.existsSync(assetsPath)) {
                await this.scanDirectoryForMetaFiles(assetsPath);
            }
        }
        
        // Also try workspace.findFiles as fallback
        const metaFiles = await vscode.workspace.findFiles('**/*.cs.meta', '**/Library/**');
        
        for (const metaFile of metaFiles) {
            const guid = extractGuidFromMeta(metaFile.fsPath);
            if (guid) {
                const scriptPath = metaFile.fsPath.replace('.meta', '');
                this.scriptGuidMap.set(scriptPath, guid);
                this.guidToScriptPath.set(guid, scriptPath);
            }
        }

        console.log(`[UnityRefLens] Mapped ${this.scriptGuidMap.size} script GUIDs`);
    }

    /**
     * Recursively scan directory for .cs.meta files
     */
    private async scanDirectoryForMetaFiles(dir: string): Promise<void> {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    if (!['Library', 'Temp', 'Logs', 'obj', 'Build', 'Builds'].includes(entry.name)) {
                        await this.scanDirectoryForMetaFiles(fullPath);
                    }
                } else if (entry.isFile() && entry.name.endsWith('.cs.meta')) {
                    const guid = extractGuidFromMeta(fullPath);
                    if (guid) {
                        const scriptPath = fullPath.replace('.meta', '');
                        this.scriptGuidMap.set(scriptPath, guid);
                        this.guidToScriptPath.set(guid, scriptPath);
                    }
                }
            }
        } catch (error) {
            // Ignore errors for inaccessible directories
        }
    }

    /**
     * Index a single Unity file
     */
    private async indexFile(filePath: string): Promise<void> {
        try {
            const stats = fs.statSync(filePath);
            const lastModified = stats.mtimeMs;

            // Check cache
            const cached = this.fileCache.get(filePath);
            if (cached && cached.lastModified === lastModified) {
                // Use cached references
                this.addReferencesToIndex(cached.references);
                return;
            }

            // Parse the file
            const references = parseUnityFile(filePath);
            
            if (references.length > 0) {
                console.log(`[UnityRefLens] Found ${references.length} refs in ${path.basename(filePath)}:`,
                    references.map(r => `${r.methodName}(${r.referenceType})`));
            }

            // Update cache
            this.fileCache.set(filePath, {
                filePath,
                lastModified,
                references
            });

            // Add to index
            this.addReferencesToIndex(references);
        } catch (error) {
            console.error(`[UnityRefLens] Error indexing ${filePath}:`, error);
        }
    }

    /**
     * Add references to the main index
     */
    private addReferencesToIndex(references: MethodReference[]): void {
        for (const ref of references) {
            // Always add with scriptGuid:methodName key if we have guid
            if (ref.scriptGuid) {
                const keyWithGuid = `${ref.scriptGuid}:${ref.methodName}`;
                const existing = this.index.get(keyWithGuid) || [];
                existing.push(ref);
                this.index.set(keyWithGuid, existing);
            }
            
            // ALSO always add with just methodName (empty guid prefix) for fallback matching
            // This allows matching by method name when GUID resolution fails
            const keyMethodOnly = `:${ref.methodName}`;
            const existingMethodOnly = this.index.get(keyMethodOnly) || [];
            existingMethodOnly.push(ref);
            this.index.set(keyMethodOnly, existingMethodOnly);
        }
    }

    /**
     * Get all references to a method in a specific script
     * @param scriptGuid The GUID of the script
     * @param methodName The method name
     * @returns Array of references
     */
    public getMethodReferences(scriptGuid: string, methodName: string): MethodReference[] {
        const withGuid = this.index.get(`${scriptGuid}:${methodName}`) || [];
        const withoutGuid = this.index.get(`:${methodName}`) || [];
        
        // Combine and deduplicate
        const combined = [...withGuid];
        
        // Add method-only matches that don't have a conflicting GUID
        for (const ref of withoutGuid) {
            if (!ref.scriptGuid || ref.scriptGuid === scriptGuid) {
                combined.push(ref);
            }
        }

        return combined;
    }

    /**
     * Get all references for all methods in a script
     * @param scriptGuid The GUID of the script
     * @returns Map of methodName -> references
     */
    public getAllMethodReferencesForScript(scriptGuid: string): Map<string, MethodReference[]> {
        const result = new Map<string, MethodReference[]>();

        for (const [key, refs] of this.index) {
            const colonIndex = key.indexOf(':');
            const guid = key.substring(0, colonIndex);
            const methodName = key.substring(colonIndex + 1);
            
            // Match if:
            // 1. GUID matches exactly
            // 2. OR it's a method-only key (empty guid) - always include for method name matching
            if (guid === scriptGuid || guid === '') {
                // For method-only keys, include all refs (we'll dedupe later)
                // For GUID keys, filter by GUID
                const refsToAdd = guid === '' ? refs : refs.filter(r => !r.scriptGuid || r.scriptGuid === scriptGuid);
                
                if (refsToAdd.length > 0) {
                    const existing = result.get(methodName) || [];
                    // Deduplicate by filePath + lineNumber
                    for (const ref of refsToAdd) {
                        const isDuplicate = existing.some(e => 
                            e.filePath === ref.filePath && e.lineNumber === ref.lineNumber
                        );
                        if (!isDuplicate) {
                            existing.push(ref);
                        }
                    }
                    result.set(methodName, existing);
                }
            }
        }

        return result;
    }

    /**
     * Get the GUID for a script file
     */
    public getScriptGuid(scriptPath: string): string | undefined {
        // Normalize path
        const normalizedPath = path.normalize(scriptPath);
        
        // Try direct lookup
        let guid = this.scriptGuidMap.get(normalizedPath);
        if (guid) return guid;

        // Try case-insensitive lookup
        for (const [cachedPath, cachedGuid] of this.scriptGuidMap) {
            if (cachedPath.toLowerCase() === normalizedPath.toLowerCase()) {
                return cachedGuid;
            }
        }

        // Try reading .meta file directly
        const metaPath = scriptPath + '.meta';
        guid = extractGuidFromMeta(metaPath) || undefined;
        if (guid) {
            this.scriptGuidMap.set(normalizedPath, guid);
            this.guidToScriptPath.set(guid, normalizedPath);
        }

        return guid;
    }

    /**
     * Get the script path for a GUID
     */
    public getScriptPath(guid: string): string | undefined {
        return this.guidToScriptPath.get(guid);
    }

    /**
     * Setup file watcher for Unity files
     */
    private setupFileWatcher(): void {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{unity,prefab,meta}');

        this.fileWatcher.onDidChange(async (uri) => {
            console.log(`[UnityRefLens] File changed: ${uri.fsPath}`);
            await this.handleFileChange(uri.fsPath);
        });

        this.fileWatcher.onDidCreate(async (uri) => {
            console.log(`[UnityRefLens] File created: ${uri.fsPath}`);
            await this.handleFileChange(uri.fsPath);
        });

        this.fileWatcher.onDidDelete((uri) => {
            console.log(`[UnityRefLens] File deleted: ${uri.fsPath}`);
            this.handleFileDelete(uri.fsPath);
        });
    }

    /**
     * Handle file change event
     */
    private async handleFileChange(filePath: string): Promise<void> {
        if (filePath.endsWith('.meta')) {
            // Rebuild script GUID map
            const scriptPath = filePath.replace('.meta', '');
            if (scriptPath.endsWith('.cs')) {
                const guid = extractGuidFromMeta(filePath);
                if (guid) {
                    this.scriptGuidMap.set(scriptPath, guid);
                    this.guidToScriptPath.set(guid, scriptPath);
                }
            }
        } else {
            // Remove old cache
            this.fileCache.delete(filePath);
            
            // Re-index the file
            // First, remove old references from this file
            this.removeReferencesFromFile(filePath);
            
            // Then add new ones
            await this.indexFile(filePath);
            
            this._onIndexUpdated.fire();
        }
    }

    /**
     * Handle file deletion
     */
    private handleFileDelete(filePath: string): void {
        this.fileCache.delete(filePath);
        this.removeReferencesFromFile(filePath);
        this._onIndexUpdated.fire();
    }

    /**
     * Remove all references from a specific file
     */
    private removeReferencesFromFile(filePath: string): void {
        for (const [key, refs] of this.index) {
            const filtered = refs.filter(r => r.filePath !== filePath);
            if (filtered.length === 0) {
                this.index.delete(key);
            } else {
                this.index.set(key, filtered);
            }
        }
    }

    /**
     * Get total number of references in the index
     */
    public getTotalReferenceCount(): number {
        let count = 0;
        for (const refs of this.index.values()) {
            count += refs.length;
        }
        return count;
    }

    /**
     * Check if index is built
     */
    public isIndexBuilt(): boolean {
        return this.fileCache.size > 0;
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        this.fileWatcher?.dispose();
        this._onIndexUpdated.dispose();
    }
}

// Singleton instance
let indexService: ReferenceIndexService | undefined;

export function getReferenceIndexService(): ReferenceIndexService {
    if (!indexService) {
        indexService = new ReferenceIndexService();
    }
    return indexService;
}

export function disposeReferenceIndexService(): void {
    indexService?.dispose();
    indexService = undefined;
}
