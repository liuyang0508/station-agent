/**
 * Route Registry — Route registration helper
 *
 * Provides a clean pattern for organizing server routes:
 * - Each route module exports { method, path, handler }
 * - Registry.collect() gathers all routes from modules
 * - Server uses registry to dispatch requests
 */

export class RouteRegistry {
  constructor() {
    this.routes = [];
  }

  /**
   * Register a route
   */
  register(method, path, handler) {
    this.routes.push({ method: method.toUpperCase(), path, handler });
  }

  /**
   * Convenience methods
   */
  get(path, handler) { this.register('GET', path, handler); }
  post(path, handler) { this.register('POST', path, handler); }
  patch(path, handler) { this.register('PATCH', path, handler); }
  put(path, handler) { this.register('PUT', path, handler); }
  delete(path, handler) { this.register('DELETE', path, handler); }

  /**
   * Match a request to a route handler
   */
  match(method, pathname) {
    method = method.toUpperCase();
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (this._pathMatches(route.path, pathname)) {
        return route;
      }
    }
    return null;
  }

  /**
   * Check if route path matches pathname
   * Supports: exact match, patterns like /api/items/:id
   */
  _pathMatches(routePath, pathname) {
    if (routePath === pathname) return true;

    const routeParts = routePath.split('/');
    const pathParts = pathname.split('/');

    if (routeParts.length !== pathParts.length) return false;

    for (let i = 0; i < routeParts.length; i++) {
      const routePart = routeParts[i];
      const pathPart = pathParts[i];

      // Skip wildcard
      if (routePart === '*') continue;

      // Parameter (e.g., :id)
      if (routePart.startsWith(':')) continue;

      // Exact match required
      if (routePart !== pathPart) return false;
    }

    return true;
  }

  /**
   * Extract params from pathname based on route pattern
   */
  extractParams(routePath, pathname) {
    const params = {};
    const routeParts = routePath.split('/');
    const pathParts = pathname.split('/');

    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        params[routeParts[i].slice(1)] = pathParts[i];
      }
    }

    return params;
  }

  /**
   * Get all registered routes
   */
  list() {
    return this.routes.map(r => ({
      method: r.method,
      path: r.path
    }));
  }

  /**
   * Collect routes from multiple route modules
   */
  static collect(...modules) {
    const registry = new RouteRegistry();
    for (const mod of modules) {
      if (typeof mod === 'function') {
        mod(registry);
      } else if (mod && typeof mod === 'object') {
        // Module with default export
        if (typeof mod.default === 'function') {
          mod.default(registry);
        }
        // Or named exports that are route functions
        for (const [name, fn] of Object.entries(mod)) {
          if (name !== 'default' && typeof fn === 'function') {
            fn(registry);
          }
        }
      }
    }
    return registry;
  }
}
