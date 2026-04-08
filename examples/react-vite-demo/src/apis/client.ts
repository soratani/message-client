/* eslint-disable @typescript-eslint/no-explicit-any */
import { HttpClient, HttpLogger, Platform, Storage } from '@soratani-code/web-http';
import { load } from '@fingerprintjs/fingerprintjs';
import { log } from '@soratani-code/samtools'
import { IDBPDatabase, openDB } from 'idb'

function getVisitorId(): Promise<string> {
    return load().then((fp) => fp.get()).then((res) => res.visitorId);
}


class CacheStorage implements Storage {
    private dbPromise: Promise<IDBPDatabase>;

    constructor() {
        console.log('Initializing IndexedDB for CacheStorage');
        this.dbPromise = openDB('appdatabase', 2, {
            upgrade(db, oldVersion, newVersion) {
                log.info('Upgrading IndexedDB from version', oldVersion, 'to', newVersion);
                if (!db.objectStoreNames.contains('tokens')) {
                    db.createObjectStore('tokens');
                    log.info('Created object store: tokens');
                }
            },
            blocked(currentVersion, blockedVersion, event) {
                log.warn('IndexedDB upgrade blocked from version', currentVersion, 'to', blockedVersion);
                log.warn('Blocked event:', event);
            },
            blocking(currentVersion, blockedVersion, event) {
                log.warn('IndexedDB upgrade blocking from version', currentVersion, 'to', blockedVersion);
                log.warn('Blocking event:', event);
            },
            terminated() {
                log.error('IndexedDB connection terminated unexpectedly');
            },
        });
    }

    async get(key: string, value?: any) {
        try {
            const db = await this.dbPromise;
            const result = await db.get('tokens', key);
            return result ?? value;
        } catch (err) {
            log.error('IndexedDB get error:', err);
            return value;
        }
    }

    async set(key: string, value: any) {
        try {
            const db = await this.dbPromise;
            await db.put('tokens', value, key);
            return true;
        } catch (err) {
            log.error('IndexedDB set error:', err);
            return false;
        }
    }
}

class Logger implements HttpLogger {
    log(label: string, message: string): void {
        log.log(label, message);
    }
    info(label: string, ...message: any[]): void {
        log.info(label, ...message);
    }
    warn(label: string, ...message: any[]): void {
        log.warn(label, ...message);
    }
    error(label: string, ...message: any[]): void {
        log.error(label, ...message);
    }

}

export const cache = new CacheStorage();
const logger = new Logger();

const http = new HttpClient({
    headers: {
        platform: Platform.web,
        prefix: 'api',
        app: 'admin',
        version: '1.0.0',
        sign: 'hephaestus-admin',
        device: getVisitorId,
    },
    retry: 1,
    storage: cache,
    logger,
    token: {
        accessKey: 'access_token',
        refreshKey: 'refresh_token',
        refreshPath: '/auth/refresh',
    }
});


export default http;
