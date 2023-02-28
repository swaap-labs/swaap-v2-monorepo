export enum SafeguardPoolSwapKind {
    GIVEN_IN = 0,
    GIVEN_OUT
}

export enum SafeguardPoolJoinKind {
    INIT = 0,
    EXACT_TOKENS_IN_FOR_BPT_OUT,
}
  
export enum SafeguardPoolExitKind {
    EXACT_BPT_IN_FOR_ONE_TOKEN_OUT = 0,
    EXACT_BPT_IN_FOR_TOKENS_OUT,
    BPT_IN_FOR_EXACT_TOKENS_OUT,
    REMOVE_TOKEN,
}