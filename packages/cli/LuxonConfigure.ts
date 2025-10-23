declare module 'luxon' {
    interface TSSettings {
        throwOnInvalid: true
    }
}

import {Settings} from "luxon";
Settings.throwOnInvalid = true;
