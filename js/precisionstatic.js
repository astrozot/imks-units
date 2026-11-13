// No server computation: immutable native JPL chunks on free static hosting.
import {createDataSession,DATA_LIMITS} from './precisiondata.js';
export const STATIC_LIMITS=DATA_LIMITS;
export const createStaticSession=(endpoint,progress,signal,fetcher)=>createDataSession(endpoint,progress,signal,fetcher,'static');
