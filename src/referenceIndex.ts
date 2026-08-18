/**
 * Reference Index Service
 * Builds and maintains an index of all Unity method references
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MethodReference, ScriptReference, UnityFileCache, ReferenceIndex } from './types';
import { parseUnityFile, parseUnityFileForScripts, extractGuidFromMeta, detectPrefabVariant } from './unityParser';

export class ReferenceIndexService {
    private index: ReferenceIndex = new Map();
    private scriptIndex: Map<string, ScriptReference[]> = new Map(); // scriptGuid -> script usages
    private fileCache: Map<string, UnityFileCache> = new Map();
    private scriptGuidMap: Map<string, string> = new Map(); // scriptPath -> guid
    private guidToScriptPath: Map<string, string> = new Map(); // guid -> scriptPath
    private prefabGuidToPath: Map<string, string> = new Map(); // prefab guid -> file path
    private prefabScripts: Map<string, string[]> = new Map(); // prefab file path -> script guids
    private variantSources: Map<string, string> = new Map(); // variant file path -> source prefab guid
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
        this.scriptIndex.clear();
        this.fileCache.clear();
        this.prefabGuidToPath.clear();
        this.prefabScripts.clear();
        this.variantSources.clear();

        try {
            // First, detect Unity project roots from open editors and workspace
            await this.detectUnityProjects();
            
            // Build the script GUID map
            progress?.report({ message: 'Scanning .meta files...', increment: 0 });
            await this.buildScriptGuidMap();
            
            // Build prefab GUID map (prefab guid -> file path)
            progress?.report({ message: 'Building prefab GUID map...', increment: 5 });
            await this.buildPrefabGuidMap();

            // Find all Unity files from detected project roots
            progress?.report({ message: 'Finding Unity files...', increment: 5 });
            const unityFiles = await this.findUnityFiles();
            
            console.log(`[UnityRefLens] Found ${unityFiles.length} Unity files to index`);
            
            const totalFiles = unityFiles.length;
            let processed = 0;

            // First pass: index all files and collect variant info
            for (const filePath of unityFiles) {
                progress?.report({
                    message: `Parsing ${path.basename(filePath)}...`,
                    increment: totalFiles > 0 ? (60 / totalFiles) : 0
                });

                await this.indexFile(filePath);
                processed++;
            }
            
            // Second pass: resolve variant scripts from source prefabs
            progress?.report({ message: 'Resolving variant scripts...', increment: 10 });
            await this.resolveVariantScripts();

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
     * Build a map of prefab GUIDs to their file paths
     */
    private async buildPrefabGuidMap(): Promise<void> {
        for (const projectRoot of this.unityProjectRoots) {
            const assetsPath = path.join(projectRoot, 'Assets');
            if (fs.existsSync(assetsPath)) {
                await this.scanDirectoryForPrefabMetaFiles(assetsPath);
            }
        }
        console.log(`[UnityRefLens] Mapped ${this.prefabGuidToPath.size} prefab GUIDs`);
    }

    /**
     * Recursively scan directory for .prefab.meta files
     */
    private async scanDirectoryForPrefabMetaFiles(dir: string): Promise<void> {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    if (!['Library', 'Temp', 'Logs', 'obj', 'Build', 'Builds'].includes(entry.name)) {
                        await this.scanDirectoryForPrefabMetaFiles(fullPath);
                    }
                } else if (entry.isFile() && entry.name.endsWith('.prefab.meta')) {
                    const guid = extractGuidFromMeta(fullPath);
                    if (guid) {
                        const prefabPath = fullPath.replace('.meta', '');
                        this.prefabGuidToPath.set(guid, prefabPath);
                    }
                }
            }
        } catch (error) {
            // Ignore errors for inaccessible directories
        }
    }

    /**
     * Resolve inherited scripts for prefab variants from their source prefabs
     */
    private async resolveVariantScripts(): Promise<void> {
        console.log(`[UnityRefLens] Resolving scripts for ${this.variantSources.size} variants`);

        // For each variant, find its source prefab and add inherited scripts
        for (const [variantPath, sourcePrefabGuid] of this.variantSources) {
            const sourcePrefabPath = this.prefabGuidToPath.get(sourcePrefabGuid);
            if (!sourcePrefabPath) {
                console.log(`[UnityRefLens] Could not find source prefab for variant ${path.basename(variantPath)}, guid: ${sourcePrefabGuid}`);
                continue;
            }

            console.log(`[UnityRefLens] Resolving variant ${path.basename(variantPath)} from source ${path.basename(sourcePrefabPath)}`);

            // Get script references from the source prefab
            const sourceScriptRefs = parseUnityFileForScripts(sourcePrefabPath);
            const variantFileName = path.basename(variantPath);
            
            // Add these scripts as references to the variant (as inherited scripts)
            for (const sourceRef of sourceScriptRefs) {
                const existing = this.scriptIndex.get(sourceRef.scriptGuid) || [];
                
                // Check if variant already has this script directly
                const alreadyHasScript = existing.some(e => 
                    e.filePath === variantPath && e.scriptGuid === sourceRef.scriptGuid
                );
                
                if (!alreadyHasScript) {
                    // Add as inherited reference
                    existing.push({
                        ...sourceRef,
                        filePath: variantPath,
                        fileName: variantFileName,
                        fileType: 'variant',
                        sourcePrefabGuid: sourcePrefabGuid,
                        gameObjectName: sourceRef.gameObjectName ? sourceRef.gameObjectName + ' (inherited)' : '(inherited)'
                    });
                    this.scriptIndex.set(sourceRef.scriptGuid, existing);
                    console.log(`[UnityRefLens]   Added inherited script reference for ${sourceRef.scriptGuid}`);
                }
            }
        }

        console.log(`[UnityRefLens] Variant script resolution complete`);
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

            // Parse the file for method references
            const references = parseUnityFile(filePath);
            
            // Parse the file for script references (class usage)
            const scriptRefs = parseUnityFileForScripts(filePath);
            this.addScriptReferencesToIndex(scriptRefs);
            
            // Track variant and its source prefab for later resolution
            if (scriptRefs.length > 0 && scriptRefs[0].fileType === 'variant' && scriptRefs[0].sourcePrefabGuid) {
                this.variantSources.set(filePath, scriptRefs[0].sourcePrefabGuid);
            } else if (scriptRefs.length === 0 && filePath.endsWith('.prefab')) {
                // Even if no scripts parsed, check if it's a variant
                const content = fs.readFileSync(filePath, 'utf8');
                const variantInfo = detectPrefabVariant(content);
                if (variantInfo.isVariant && variantInfo.sourcePrefabGuid) {
                    this.variantSources.set(filePath, variantInfo.sourcePrefabGuid);
                    console.log(`[UnityRefLens] Detected variant without direct scripts: ${path.basename(filePath)}`);
                }
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
     * Add script references to the script index
     * Deduplicates by filePath + hierarchyPath to avoid counting same GameObject multiple times
     */
    private addScriptReferencesToIndex(refs: ScriptReference[]): void {
        for (const ref of refs) {
            const existing = this.scriptIndex.get(ref.scriptGuid) || [];
            
            // Check for duplicates - same file + same hierarchy path = same reference
            const isDuplicate = existing.some(e => 
                e.filePath === ref.filePath && 
                (e.hierarchyPath === ref.hierarchyPath || 
                 (e.gameObjectName === ref.gameObjectName && e.lineNumber === ref.lineNumber))
            );
            
            if (!isDuplicate) {
                existing.push(ref);
                this.scriptIndex.set(ref.scriptGuid, existing);
            }
        }
    }

    /**
     * Add references to the main index
     */
    private addReferencesToIndex(references: MethodReference[]): void {
        for (const ref of references) {
            if (!ref.scriptGuid) {
                continue;
            }

            const keyWithGuid = `${ref.scriptGuid}:${ref.methodName}`;
            const existing = this.index.get(keyWithGuid) || [];
            existing.push(ref);
            this.index.set(keyWithGuid, existing);
        }
    }

    /**
     * Get all references to a method in a specific script
     * @param scriptGuid The GUID of the script
     * @param methodName The method name
     * @returns Array of references
     */
    public getMethodReferences(scriptGuid: string, methodName: string): MethodReference[] {
        return this.index.get(`${scriptGuid}:${methodName}`) || [];
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

            if (guid !== scriptGuid) {
                continue;
            }

            const existing = result.get(methodName) || [];
            for (const ref of refs) {
                const isDuplicate = existing.some(e =>
                    e.filePath === ref.filePath && e.lineNumber === ref.lineNumber
                );
                if (!isDuplicate) {
                    existing.push(ref);
                }
            }
            result.set(methodName, existing);
        }

        return result;
    }

    /**
     * Get all references where a script is attached to GameObjects
     * @param scriptGuid The GUID of the script
     * @returns Array of script references
     */
    public getScriptReferences(scriptGuid: string): ScriptReference[] {
        return this.scriptIndex.get(scriptGuid) || [];
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
