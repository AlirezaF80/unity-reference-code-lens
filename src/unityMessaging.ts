import * as dgram from 'dgram';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as vscode from 'vscode';

const Ping = 1;
const Pong = 2;
const ShowUsage = 25;

export async function showAssetInUnityEditor(
    filePath: string,
    hierarchyPath?: string
): Promise<void> {
    const projectRoot = findUnityProjectRoot(filePath);
    if (!projectRoot) {
        throw new Error('Could not find a Unity project (Assets + ProjectSettings) for this file.');
    }

    const assetPath = toUnityAssetPath(projectRoot, filePath);
    const gameObjectPath = hierarchyToGameObjectPath(hierarchyPath);
    const payload: Record<string, unknown> = { Path: assetPath };
    if (gameObjectPath.length > 0) {
        payload.GameObjectPath = gameObjectPath;
    }
    const json = JSON.stringify(payload);

    const ports = unique(unityMessagingPorts());
    if (ports.length === 0) {
        throw new Error('No Unity.exe process found. Open this project in the Unity Editor.');
    }

    const reachable = await pingFirstReachablePort(ports);
    if (reachable === undefined) {
        throw new Error(
            `Unity is running (${ports.length} messaging port${ports.length === 1 ? '' : 's'} tried) but Visual Studio Editor is not listening. Quit all Unity editors and reopen the project with External Script Editor already set to Visual Studio Code (must show "Visual Studio Editor v2.0.22 enabled"). Changing that dropdown after Unity is open does not start the UDP listener.`
        );
    }

    await sendUdp(reachable.socket, reachable.port, ShowUsage, json);
    reachable.socket.close();
}

export async function showAssetInUnityEditorOrWarn(
    filePath: string,
    hierarchyPath?: string
): Promise<void> {
    try {
        await showAssetInUnityEditor(filePath, hierarchyPath);
        vscode.window.showInformationMessage('Pinged Unity Editor. Check the Project window.');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showWarningMessage(`Could not ping Unity Editor: ${message}`);
    }
}

function unityMessagingPorts(): number[] {
    return unityProcessIds().map(pid => 56000 + (pid % 1000) + 2);
}

function unityProcessIds(): number[] {
    try {
        const output = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Unity.exe', '/FO', 'CSV', '/NH'], {
            encoding: 'utf8'
        });
        const ids: number[] = [];
        for (const line of output.split(/\r?\n/)) {
            const match = line.match(/"Unity\.exe","(\d+)"/i);
            if (match) {
                ids.push(Number(match[1]));
            }
        }
        return ids;
    } catch {
        return [];
    }
}

function toUnityAssetPath(projectRoot: string, filePath: string): string {
    const relative = path.relative(projectRoot, filePath).split(path.sep).join('/');
    if (!relative || relative.startsWith('..')) {
        throw new Error(`File is outside the Unity project: ${filePath}`);
    }
    return relative;
}

function hierarchyToGameObjectPath(hierarchyPath?: string): string[] {
    if (!hierarchyPath) {
        return [];
    }

    return hierarchyPath
        .replace(/\s*\(inherited\)\s*$/i, '')
        .split('/')
        .map(part => part.trim())
        .filter(part => part.length > 0);
}

function findUnityProjectRoot(startPath: string): string | undefined {
    let current = path.resolve(fs.existsSync(startPath) && fs.statSync(startPath).isFile()
        ? path.dirname(startPath)
        : startPath);

    while (true) {
        const assets = path.join(current, 'Assets');
        const projectSettings = path.join(current, 'ProjectSettings');
        if (fs.existsSync(assets) && fs.existsSync(projectSettings)) {
            return current;
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return undefined;
        }
        current = parent;
    }
}

function serializeMessage(type: number, value: string): Buffer {
    const valueBuffer = Buffer.from(value, 'utf8');
    const buffer = Buffer.alloc(8 + valueBuffer.length);
    buffer.writeInt32LE(type, 0);
    buffer.writeInt32LE(valueBuffer.length, 4);
    valueBuffer.copy(buffer, 8);
    return buffer;
}

function readMessageType(buffer: Buffer): number | undefined {
    if (buffer.length < 4) {
        return undefined;
    }
    return buffer.readInt32LE(0);
}

function unique(values: number[]): number[] {
    return [...new Set(values)];
}

function sendUdp(socket: dgram.Socket, port: number, type: number, value: string): Promise<void> {
    return new Promise((resolve, reject) => {
        socket.send(serializeMessage(type, value), port, '127.0.0.1', error => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

function pingFirstReachablePort(ports: number[]): Promise<{ socket: dgram.Socket; port: number } | undefined> {
    return new Promise(resolve => {
        const socket = dgram.createSocket('udp4');
        let settled = false;

        const finish = (port?: number) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            socket.removeAllListeners();
            if (port === undefined) {
                socket.close();
                resolve(undefined);
                return;
            }
            resolve({ socket, port });
        };

        const timer = setTimeout(() => finish(undefined), 1500);

        socket.on('error', () => finish(undefined));
        socket.on('message', (message, remote) => {
            if (readMessageType(message) === Pong) {
                finish(remote.port);
            }
        });

        socket.bind(0, () => {
            for (const port of ports) {
                socket.send(serializeMessage(Ping, ''), port, '127.0.0.1');
            }
        });
    });
}
