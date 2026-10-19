import { handleFishProxy } from './handler.ts';
Deno.serve(request => handleFishProxy(request));
