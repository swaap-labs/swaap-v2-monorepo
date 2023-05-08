export enum SafeguardPoolSwapKind {
    GIVEN_IN = 0,
    GIVEN_OUT
}

export enum SafeguardPoolJoinKind {
    INIT = 0,
    ALL_TOKENS_IN_FOR_EXACT_BPT_OUT,
    EXACT_TOKENS_IN_FOR_BPT_OUT,
}

export enum SafeguardPoolExitKind {
    EXACT_BPT_IN_FOR_TOKENS_OUT = 0,
    BPT_IN_FOR_EXACT_TOKENS_OUT,
}
