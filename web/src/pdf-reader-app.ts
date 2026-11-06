const readerDesktopBridge = window.bookstrDesktop as {focusLibrary?():void;openPane?(pane?:string):void}|undefined || null;
(document.getElementById('back-to-library') as HTMLElement).addEventListener('click', () => readerDesktopBridge?.focusLibrary?.());
const readerMenuToggle = (document.getElementById('reader-menu-toggle') as HTMLElement);
const readerMenu = (document.getElementById('reader-menu') as HTMLElement);
readerMenuToggle.addEventListener('click', () => {
    const open = readerMenu.hidden;
    readerMenu.hidden = !open;
    readerMenuToggle.setAttribute('aria-expanded', String(open));
});
readerMenu.querySelectorAll<HTMLElement>('[data-reader-pane]').forEach(button => {
    button.addEventListener('click', () => readerDesktopBridge?.openPane?.(button.dataset.readerPane));
});
