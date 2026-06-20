const ergogen = require('../../src/ergogen')
const version = require('../../package.json').version
const sinon = require('sinon')

describe('Footprint Engine', function() {

    it('should throw error for incompatible engine version', async function() {
        const config = {
            points: {
                zones: {
                    matrix: {
                        columns: {
                            main: {
                                key: {
                                    footprints: {
                                        f: {
                                            what: 'test_fp'
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            pcbs: {
                main: {
                    footprints: {
                        f: {
                            what: 'test_fp',
                            where: true
                        }
                    }
                }
            }
        }

        ergogen.inject('test_fp', {
            engine: '99.0.0',
            params: {},
            body: p => 'body'
        })

        return ergogen.process(config).should.be.rejectedWith('doesn\'t satisfy footprint "test_fp"\'s engine requirement (99.0.0)!')
    })

    it('should work for compatible engine version', async function() {
        const config = {
            points: {
                zones: {
                    matrix: {
                        columns: {
                            main: {
                                key: {
                                    footprints: {
                                        f: {
                                            what: 'ok_fp'
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            pcbs: {
                main: {
                    footprints: {
                        f: {
                            where: true,
                            what: 'ok_fp'
                        }
                    }
                }
            }
        }

        ergogen.inject('ok_fp', {
            engine: '4.1.2',
            params: {},
            body: p => 'body'
        })

        const result = await ergogen.process(config)
        result.pcbs.main.should.contain('body')
    })

    it('should log warning and assume 4.1.2 when engine is missing', async function() {
        const config = {
            points: {
                zones: {
                    matrix: {
                        columns: {
                            main: {
                                key: {
                                    footprints: {
                                        f: {
                                            what: 'missing_fp'
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            pcbs: {
                main: {
                    footprints: {
                        f: {
                            where: true,
                            what: 'missing_fp'
                        }
                    }
                }
            }
        }

        ergogen.inject('missing_fp', {
            params: {},
            body: p => 'body'
        })

        const logger = sinon.spy()
        await ergogen.process(config, {}, logger)

        logger.calledWith('Footprint "missing_fp" does not specify an "engine" version. Assuming 4.1.2. Please update the footprint to include the "engine" property.').should.be.true
    })

    it('should only log warning once per footprint type', async function() {
        const config = {
            points: {
                zones: {
                    matrix: {
                        columns: {
                            main: {
                                key: {
                                    footprints: {
                                        f1: { what: 'multi_fp' },
                                        f2: { what: 'multi_fp' }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            pcbs: {
                main: {
                    footprints: {
                        f1: { where: true, what: 'multi_fp' },
                        f2: { where: true, what: 'multi_fp' }
                    }
                }
            }
        }

        ergogen.inject('multi_fp', {
            params: {},
            body: p => 'body'
        })

        const logger = sinon.spy()
        await ergogen.process(config, {}, logger)

        logger.withArgs('Footprint "multi_fp" does not specify an "engine" version. Assuming 4.1.2. Please update the footprint to include the "engine" property.').calledOnce.should.be.true
    })
})
