// Optional original-file range transport. Static hosting is preferred.
import {createDataSession,DATA_LIMITS} from './precisiondata.js';
export const R2_LIMITS=DATA_LIMITS;
export const createR2Session=(...args)=>createDataSession(...args);
