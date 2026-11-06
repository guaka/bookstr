type Nip17FetchModule = typeof import('../src/nip17-fetch.js');

declare module '*nip17-fetch.js' {
  export const LIBCAT_SERVICE: Nip17FetchModule['LIBCAT_SERVICE'];
  export const LIBVAULT_FETCH_TYPE: Nip17FetchModule['LIBVAULT_FETCH_TYPE'];
  export const LIBVAULT_FAVORITES_TYPE: Nip17FetchModule['LIBVAULT_FAVORITES_TYPE'];
  export const LIBVAULT_NIP05: Nip17FetchModule['LIBVAULT_NIP05'];
  export const LIBVAULT_RESOLVE_RESPONSE_TYPE: Nip17FetchModule['LIBVAULT_RESOLVE_RESPONSE_TYPE'];
  export const LIBVAULT_RESOLVE_TYPE: Nip17FetchModule['LIBVAULT_RESOLVE_TYPE'];
  export const LIBVAULT_SEARCH_RESPONSE_TYPE: Nip17FetchModule['LIBVAULT_SEARCH_RESPONSE_TYPE'];
  export const libvaultBookRef: Nip17FetchModule['libvaultBookRef'];
  export const resolveLibcatBook: Nip17FetchModule['resolveLibcatBook'];
  export const resolveLibVaultBook: Nip17FetchModule['resolveLibVaultBook'];
  export const resolveLibVaultService: Nip17FetchModule['resolveLibVaultService'];
  export const searchLibcat: Nip17FetchModule['searchLibcat'];
  export const searchLibVault: Nip17FetchModule['searchLibVault'];
  export const sendLibVaultFavoritesSync: Nip17FetchModule['sendLibVaultFavoritesSync'];
  export const sendLibVaultFetchRequest: Nip17FetchModule['sendLibVaultFetchRequest'];
  export const unwrapLibVaultResponse: Nip17FetchModule['unwrapLibVaultResponse'];
}
