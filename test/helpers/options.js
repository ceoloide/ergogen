exports.parse = (argv, env) => {
    const flag = name => {
        const index = argv.findIndex(arg => arg == `--${name}` || arg.startsWith(`--${name}=`))
        if (index == -1) return env[`npm_config_${name}`]
        const arg = argv[index]
        if (arg.includes('=')) return arg.slice(arg.indexOf('=') + 1)
        const next = argv[index + 1]
        return next && !next.startsWith('-') ? next : 'true'
    }

    const dump = flag('dump') || 'false'
    if (!['true', '1', 'false', '0'].includes(dump)) throw new Error(`Unknown value "${dump}" for --dump!`)
    const what = flag('what')
    return {what: what ? what.split(',') : false, dump: dump == 'true' || dump == '1'}
}
