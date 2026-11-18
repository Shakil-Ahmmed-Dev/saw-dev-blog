const NAV_STACK_KEY = "astro-paper:nav-stack";
const MAX_STACK_LENGTH = 50;

export interface InitialStackOptions {
  navType?: string;
  referrer?: string;
  origin: string;
  isHome?: boolean;
}

export interface SoftNavigation {
  fromUrl: string;
  toUrl: string;
  direction: "forward" | "back";
  navigationType: "push" | "replace" | "traverse";
  viaBackButton: boolean;
  isHome?: boolean;
}

interface TransitionPreparationEvent extends Event {
  from: URL;
  to: URL;
  direction: "forward" | "back";
  navigationType: "push" | "replace" | "traverse";
  sourceElement?: Element;
}

export function isSafeInternalUrl(url: unknown): url is string {
  return (
    typeof url === "string" && url.startsWith("/") && !url.startsWith("//")
  );
}

function toInternalUrl(url: URL | Location): string {
  return `${url.pathname}${url.search}`;
}

function getPathname(internalUrl: string): string {
  const queryIndex = internalUrl.indexOf("?");
  return queryIndex === -1 ? internalUrl : internalUrl.slice(0, queryIndex);
}

function clampStack(stack: string[]): string[] {
  return stack.length > MAX_STACK_LENGTH
    ? stack.slice(stack.length - MAX_STACK_LENGTH)
    : stack;
}

function parseSameOriginReferrer(
  referrer: string | undefined,
  origin: string
): string | undefined {
  if (!referrer) return undefined;
  try {
    const url = new URL(referrer);
    if (url.origin !== origin) return undefined;
    const internal = toInternalUrl(url);
    return isSafeInternalUrl(internal) ? internal : undefined;
  } catch {
    return undefined;
  }
}

export function computeInitialStack(
  existingStack: string[],
  currentUrl: string,
  options: InitialStackOptions
): string[] {
  const stack = existingStack.filter(isSafeInternalUrl);

  if (options.isHome) {
    return [currentUrl];
  }

  if (options.navType === "reload") {
    if (stack.length === 0) return [currentUrl];
    const next = [...stack];
    if (next[next.length - 1] !== currentUrl) {
      if (getPathname(next[next.length - 1]) === getPathname(currentUrl)) {
        next[next.length - 1] = currentUrl;
      } else {
        next.push(currentUrl);
      }
    }
    return clampStack(next);
  }

  if (options.navType === "back_forward") {
    if (stack.length === 0) return [currentUrl];
    const next = [...stack];
    if (next[next.length - 1] === currentUrl) {
      return next;
    }
    if (next.length >= 2 && next[next.length - 2] === currentUrl) {
      next.pop();
      return next;
    }
    const existingIdx = next.lastIndexOf(currentUrl);
    if (existingIdx !== -1) {
      return next.slice(0, existingIdx + 1);
    }
    next.push(currentUrl);
    return clampStack(next);
  }

  // Fresh "navigate" (or unknown navType):
  // Only preserve/seed history when the referrer is from the same origin.
  // External arrivals (e.g. Google/YouTube) or direct URL visits start a fresh stack
  // so "Go back" falls back to the homepage instead of an external site or stale tab history.
  const sameOriginReferrer = parseSameOriginReferrer(
    options.referrer,
    options.origin
  );

  if (!sameOriginReferrer) {
    return [currentUrl];
  }

  if (stack.length === 0) {
    return sameOriginReferrer !== currentUrl
      ? [sameOriginReferrer, currentUrl]
      : [currentUrl];
  }

  const next = [...stack];
  if (
    sameOriginReferrer !== currentUrl &&
    next[next.length - 1] !== sameOriginReferrer
  ) {
    next.push(sameOriginReferrer);
  }
  if (next[next.length - 1] !== currentUrl) {
    next.push(currentUrl);
  }
  return clampStack(next);
}

export function computeNextStack(
  existingStack: string[],
  nav: SoftNavigation
): string[] {
  if (nav.isHome) {
    return [nav.toUrl];
  }

  const next = existingStack.filter(isSafeInternalUrl);

  if (nav.fromUrl === nav.toUrl) {
    return next.length > 0 ? next : [nav.toUrl];
  }

  // Sync top entry with `fromUrl` in case `history.replaceState` updated query params
  // (e.g. `/search/` → `/search/?q=astro`) before leaving the page.
  if (next.length === 0) {
    next.push(nav.fromUrl);
  } else if (getPathname(next[next.length - 1]) === getPathname(nav.fromUrl)) {
    next[next.length - 1] = nav.fromUrl;
  } else if (next[next.length - 1] !== nav.fromUrl) {
    next.push(nav.fromUrl);
  }

  if (nav.viaBackButton) {
    if (next.length >= 2 && next[next.length - 2] === nav.toUrl) {
      next.pop();
      return next;
    }
    // Fallback navigation (e.g. direct-entry post clicking "Go back" to homepage)
    return [nav.toUrl];
  }

  if (nav.navigationType === "traverse") {
    if (nav.direction === "back") {
      if (next.length >= 2 && next[next.length - 2] === nav.toUrl) {
        next.pop();
        return next;
      }
      const existingIdx = next.lastIndexOf(nav.toUrl);
      if (existingIdx !== -1) {
        return next.slice(0, existingIdx + 1);
      }
    }
    if (next[next.length - 1] !== nav.toUrl) {
      next.push(nav.toUrl);
    }
    return clampStack(next);
  }

  if (nav.navigationType === "replace") {
    next[next.length - 1] = nav.toUrl;
    return clampStack(next);
  }

  // Normal forward navigation ("push")
  if (next[next.length - 1] !== nav.toUrl) {
    next.push(nav.toUrl);
  }
  return clampStack(next);
}

export function getBackTarget(
  stack: string[],
  currentUrl: string
): string | undefined {
  if (stack.length < 2) return undefined;
  const previous = stack[stack.length - 2];
  if (!isSafeInternalUrl(previous) || previous === currentUrl) {
    return undefined;
  }
  return previous;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  let memoryStack: string[] = [];
  let pendingNav: Omit<SoftNavigation, "isHome"> | null = null;

  const isHomePage = (): boolean =>
    document.querySelector('#main-content[data-layout="index"]') !== null;

  const readStack = (): string[] => {
    try {
      const raw = sessionStorage.getItem(NAV_STACK_KEY);
      if (!raw) return [...memoryStack];
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(isSafeInternalUrl);
      }
    } catch {
      // Fallback to in-memory stack when sessionStorage is unavailable.
    }
    return [...memoryStack];
  };

  const writeStack = (stack: string[]): void => {
    memoryStack = [...stack];
    try {
      sessionStorage.setItem(NAV_STACK_KEY, JSON.stringify(stack));
    } catch {
      // Ignore storage quota/privacy errors; in-memory fallback still works.
    }
  };

  const updateBackButton = (stack: string[]): void => {
    const backButton =
      document.querySelector<HTMLAnchorElement>("#back-button");
    if (!backButton) return;

    const currentUrl = toInternalUrl(window.location);
    const target = getBackTarget(stack, currentUrl);

    if (target) {
      backButton.href = target;
    } else if (backButton.dataset.fallbackHref) {
      backButton.href = backButton.dataset.fallbackHref;
    }
  };

  const getInitialNavType = (): string | undefined => {
    const entry = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    return entry?.type;
  };

  // Initialize on first full page load.
  const initialStack = computeInitialStack(
    readStack(),
    toInternalUrl(window.location),
    {
      navType: getInitialNavType(),
      referrer: document.referrer,
      origin: window.location.origin,
      isHome: isHomePage(),
    }
  );
  writeStack(initialStack);
  updateBackButton(initialStack);

  document.addEventListener("astro:before-preparation", rawEvent => {
    const event = rawEvent as TransitionPreparationEvent;
    const viaBackButton = Boolean(event.sourceElement?.closest("#back-button"));

    if (viaBackButton) {
      event.direction = "back";
    }

    pendingNav = {
      fromUrl: toInternalUrl(event.from),
      toUrl: toInternalUrl(event.to),
      direction: event.direction,
      navigationType: event.navigationType,
      viaBackButton,
    };
  });

  document.addEventListener("astro:page-load", () => {
    if (pendingNav) {
      const actualToUrl = toInternalUrl(window.location);
      const nextStack = computeNextStack(readStack(), {
        ...pendingNav,
        toUrl: actualToUrl,
        isHome: isHomePage(),
      });
      pendingNav = null;
      writeStack(nextStack);
      updateBackButton(nextStack);
      return;
    }

    updateBackButton(readStack());
  });
}
