import { log } from "@soratani-code/samtools";
import http from "./client";

export function login(payload: any) {
    log.info('Attempting login with payload:', payload, http);
    return http.post('/auth/account/login', payload);
}

export function check() {
    return http.get('/auth/account/check');
}