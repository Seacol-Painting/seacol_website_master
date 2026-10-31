import { createBlobStore } from '../server/blob-store.mjs';
import { createEstimateHandler } from '../server/estimate-core.mjs';
import { notifyEstimate } from '../server/notify.mjs';

const handle = createEstimateHandler({ storeFactory: createBlobStore, notify: notifyEstimate });

export function POST(request) { return handle(request); }
export function GET(request) { return handle(request); }
export function OPTIONS(request) { return handle(request); }
export function PUT(request) { return handle(request); }
export function PATCH(request) { return handle(request); }
export function DELETE(request) { return handle(request); }
