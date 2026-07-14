import { useEffect, useRef } from 'react';
import type { ChainView } from '../lib/chains';
import type { Page, Theme } from '../lib/nav';
import { pageHref } from '../lib/nav';
import { MoonIcon, SearchIcon, SunIcon } from '../ui/icons';
import { Glyph } from './primitives';

export function AppHeader({
  page,
  theme,
  setTheme,
  query,
  setQuery,
  onSearchSubmit,
  searchNote,
  chains,
  switcherOpen,
  setSwitcherOpen,
  onSelectRollup,
  activeChainId,
  showNetwork,
}: {
  page: Page;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  query: string;
  setQuery: (query: string) => void;
  onSearchSubmit: () => void;
  searchNote: string | null;
  chains: ChainView[];
  switcherOpen: boolean;
  setSwitcherOpen: (open: boolean) => void;
  onSelectRollup: (chain: number) => void;
  activeChainId: number | null;
  showNetwork: boolean;
}) {
  const host = chains.find((chain) => chain.current) ?? chains[0];
  const active = chains.find((chain) => chain.id === activeChainId) ?? host;
  const searchRef = useRef<HTMLInputElement>(null);
  const switcherButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navLinks: Array<[Page, string]> = [
    ['txs', 'TRANSACTIONS'],
    ['bridge', 'BRIDGE'],
    ['superblocks', 'SUPERBLOCKS'],
    ['mailbox', 'MAILBOX'],
    ['rollups', 'ROLLUPS'],
    ...(showNetwork ? ([['network', 'PUBLISHER']] as Array<[Page, string]>) : []),
  ];
  const activeNav = (item: Page) => {
    if (item === 'txs') return page === 'txs' || page === 'txDetail';
    if (item === 'superblocks') return page === 'superblocks' || page === 'superblockDetail';
    if (item === 'rollups') return page === 'rollups' || page === 'rollupDetail';
    return page === item;
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/">
            <img className="cs-logo-mark" src="/favicon.svg" width={36} height={36} alt="" aria-hidden="true" />
            <span>
              <strong>CrossScout</strong>
              <small className="mono">ETHERA NETWORK</small>
            </span>
          </a>
          <nav>
            {navLinks.map(([item, label]) => (
              <a
                key={item}
                className={activeNav(item) ? 'nav-link active' : 'nav-link'}
                href={pageHref(item)}
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="topbar-spacer" />
          {active && (
            <div
              className="switcher"
              onKeyDown={(event) => {
                if (event.key === 'Escape' && switcherOpen) {
                  setSwitcherOpen(false);
                  switcherButtonRef.current?.focus();
                }
              }}
            >
              <button
                type="button"
                ref={switcherButtonRef}
                className="switcher-button"
                aria-expanded={switcherOpen}
                aria-haspopup="true"
                onClick={() => setSwitcherOpen(!switcherOpen)}
              >
                <Glyph chain={active} size={20} />
                <strong className="mono">{active.name}</strong>
                <span aria-hidden="true">v</span>
              </button>
              {switcherOpen && (
                <>
                  <button
                    type="button"
                    className="menu-backdrop"
                    aria-label="Close rollup switcher"
                    onClick={() => setSwitcherOpen(false)}
                  />
                  <div className="switcher-menu">
                    <p className="mono">Indexed rollups</p>
                    {chains.map((chain) => (
                      <button
                        type="button"
                        key={chain.id}
                        className={chain.id === active.id ? 'active' : ''}
                        onClick={() => {
                          setSwitcherOpen(false);
                          onSelectRollup(chain.id);
                        }}
                      >
                        <Glyph chain={chain} size={24} />
                        <strong>{chain.name}</strong>
                        <span className="mono">#{chain.id}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="segmented icon-segmented">
            <button
              type="button"
              className={theme === 'light' ? 'active' : ''}
              onClick={() => setTheme('light')}
              aria-label="Light theme"
            >
              <SunIcon />
            </button>
            <button
              type="button"
              className={theme === 'dark' ? 'active' : ''}
              onClick={() => setTheme('dark')}
              aria-label="Dark theme"
            >
              <MoonIcon />
            </button>
          </div>
        </div>
      </header>
      <div className="search-band">
        <div className="search-inner">
          <div className="search-box">
            <SearchIcon />
            <input
              ref={searchRef}
              aria-label="Search by tx hash, session, superblock or address"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSearchSubmit();
              }}
              placeholder="Search by tx hash, session, superblock or address"
            />
            <span className="mono">CMD K</span>
          </div>
          {searchNote && (
            <p className="search-note mono" role="status">
              {searchNote}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
