<template>
    <iframe ref="tools" title="Klipper Tools" src="/tools/app/" class="klipper-tools" />
</template>

<script lang="ts">
import Vue from 'vue'

export default Vue.extend({
    data: () => ({ locked: false }),
    mounted() {
        window.addEventListener('message', this.receiveState)
    },
    beforeDestroy() {
        window.removeEventListener('message', this.receiveState)
    },
    beforeRouteLeave(_to, _from, next) {
        if (this.locked) next(false)
        else next()
    },
    methods: {
        receiveState(event: MessageEvent) {
            const frame = this.$refs.tools as HTMLIFrameElement
            if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return
            if (event.data?.type === 'kcw-navigation-state' && typeof event.data.locked === 'boolean') {
                this.locked = event.data.locked
            }
        },
    },
})
</script>

<style scoped>
.klipper-tools {
    display: block;
    width: 100%;
    height: calc(100vh - 110px);
    min-height: 500px;
    border: 0;
}
</style>
