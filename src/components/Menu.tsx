import React, { useState, useRef, useEffect } from 'react';



/** Props for the {@link Menu} dropdown component. */
export interface MenuProps {
    /** Flat or nested list of items to render in the dropdown. */
    items: MenuItem[];
    /** UI colour scheme used for background, text, and hover colours. */
    theme: 'light' | 'dark';
    /** Optional inline styles forwarded to the toggle button. */
    buttonStyle?: React.CSSProperties;
}

//******************************************************************************
// Menu
//******************************************************************************
/** A single entry in a {@link Menu} or nested submenu. */
export interface MenuItem {
    /** Visible label text. Use `'---'` to render a horizontal separator. */
    label: string;
    /** Action invoked when the item is clicked (ignored when `submenu` is set). */
    onClick?: () => void;
    /** When true the item is rendered muted and clicks are ignored. */
    disabled?: boolean;
    /** Nested items rendered as an inline sub-list below this entry. */
    submenu?: MenuItem[];
    isOpen?: boolean; // For internal state tracking if needed, but better to control via local state map or just simple modification
    /**
     * Optional hover tooltip (rendered via the native `title` attribute).
     * Used to surface keyboard shortcuts and short usage hints without
     * cluttering the visible label. Native tooltips are good enough here:
     * we want the platform's standard appearance/timing and they cost
     * nothing to render. If we ever need richer styling we can swap to a
     * custom tooltip without touching call sites.
     */
    title?: string;
}

export const Menu: React.FC<MenuProps> = ({ items, theme, buttonStyle }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [expandedSubmenus, setExpandedSubmenus] = useState<Record<number, boolean>>({});
    const menuRef = useRef<HTMLDivElement>(null);

    const toggleMenu = () => {
        setIsOpen(!isOpen);
        if (!isOpen) setExpandedSubmenus({}); // Reset submenus on close
    };

    const toggleSubmenu = (index: number, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedSubmenus(prev => ({
            ...prev,
            [index]: !prev[index]
        }));
    };

    const handleClickOutside = (event: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
            setIsOpen(false);
        }
    };

    useEffect(() => {
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const renderMenuItems = (menuItems: MenuItem[], parentIndex?: number) => {
        return menuItems.map((item, index) => {
            const key = parentIndex !== undefined ? `${parentIndex}-${index}` : `${index}`;
            const isSubmenuExpanded = expandedSubmenus[index];

            if (item.label === '---') {
                return <div key={key} style={{ height: '1px', margin: '4px 8px', backgroundColor: '#444' }} />;
            }

            return (
                <div key={key}>
                    <div
                        onClick={(e) => {
                            if (item.disabled) return;
                            if (item.submenu) {
                                toggleSubmenu(index, e);
                            } else if (item.onClick) {
                                item.onClick();
                                setIsOpen(false);
                            }
                        }}
                        className="menu-item"
                        // Native browser tooltip. Surfaces keyboard shortcuts
                        // (e.g. "Ctrl+Shift+L") on hover without taking up
                        // visible label space. Omitted entirely when the
                        // caller didn't supply one — `title={undefined}`
                        // doesn't render an empty tooltip.
                        title={item.title}
                        style={{
                            padding: '8px 16px',
                            cursor: item.disabled ? 'not-allowed' : 'pointer',
                            color: item.disabled
                                ? (theme === 'dark' ? '#484f58' : '#959da5')
                                : (theme === 'dark' ? '#c9d1d9' : '#24292e'),
                            backgroundColor: 'transparent',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '8px'
                            // Hover handled by CSS class or standard styles if we want to be pure JS
                        }}
                        onMouseEnter={(e) => {
                            if (!item.disabled) {
                                e.currentTarget.style.backgroundColor = theme === 'dark' ? '#1f6feb' : '#0366d6';
                                e.currentTarget.style.color = '#ffffff';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (!item.disabled) {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.color = theme === 'dark' ? '#c9d1d9' : '#24292e';
                            }
                        }}
                    >
                        <span>{item.label}</span>
                        {item.submenu && (
                            <span style={{ fontSize: '0.8em' }}>{isSubmenuExpanded ? '▼' : '▶'}</span>
                        )}
                    </div>
                    {item.submenu && isSubmenuExpanded && (
                        <div style={{
                            paddingLeft: '16px',
                            borderLeft: `2px solid ${theme === 'dark' ? '#30363d' : '#e1e4e8'}`,
                            marginLeft: '8px',
                            marginTop: '4px',
                            marginBottom: '4px'
                        }}>
                            {item.submenu.map((subItem, SubIndex) => (
                                <div
                                    key={`sub-${SubIndex}`}
                                    onClick={() => {
                                        if (subItem.onClick) {
                                            subItem.onClick();
                                            setIsOpen(false);
                                        }
                                    }}
                                    style={{
                                        padding: '6px 16px',
                                        cursor: 'pointer',
                                        color: theme === 'dark' ? '#8b949e' : '#57606a',
                                        fontSize: '0.9em'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = theme === 'dark' ? 'rgba(31, 111, 235, 0.2)' : 'rgba(3, 102, 214, 0.1)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                >
                                    {truncatePath(subItem.label)}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            );
        });
    };

    // Helper to truncate long paths
    const truncatePath = (path: string) => {
        if (path.length > 40) {
            const parts = path.split(/[/\\]/);
            const fileName = parts.pop();
            return `.../${fileName}`;
        }
        return path;
    };


    return (
        <div ref={menuRef} style={{ position: 'relative', display: 'inline-block' }}>
            <button
                onClick={toggleMenu}
                style={buttonStyle}
            >
                ☰ Menu
            </button>
            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '0.5rem',
                    backgroundColor: theme === 'dark' ? '#161b22' : '#ffffff',
                    border: `1px solid ${theme === 'dark' ? '#30363d' : '#e1e4e8'}`,
                    borderRadius: '6px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                    zIndex: 1000,
                    minWidth: '250px', // Wider for MRU paths
                    maxHeight: '80vh',
                    overflowY: 'auto'
                }}>
                    {renderMenuItems(items)}
                </div>
            )}
        </div>
    );
};
// Menu END ********************************************************************
