const prepare = require('../../src/prepare')
const chai = require('chai')
chai.should()

describe('Migration', () => {
    it('should migrate v3 points syntax', () => {
        const v3_config = {
            points: {
                zones: {
                    matrix: {
                        columns: {
                            index: {
                                stagger: 5,
                                spread: 19,
                                rotate: 10,
                                origin: [0, 0],
                                row_overrides: {
                                    home: {
                                        shift: [1, 1]
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        const migrated = prepare.migrate(v3_config)
        migrated.points.zones.matrix.columns.index.key.stagger.should.equal(5)
        migrated.points.zones.matrix.columns.index.key.spread.should.equal(19)
        migrated.points.zones.matrix.columns.index.key.splay.should.equal(10)
        migrated.points.zones.matrix.columns.index.key.origin.should.deep.equal([0, 0])
        migrated.points.zones.matrix.columns.index.rows.home.shift.should.deep.equal([1, 1])
        chai.expect(migrated.points.zones.matrix.columns.index.stagger).to.be.undefined
        chai.expect(migrated.points.zones.matrix.columns.index.row_overrides).to.be.undefined
    })

    it('should migrate v3 outlines type to what', () => {
        const v3_config = {
            outlines: {
                board: {
                    main: {
                        type: 'rectangle',
                        size: [10, 10]
                    }
                }
            }
        }
        const migrated = prepare.migrate(v3_config)
        migrated.outlines.board.main.what.should.equal('rectangle')
        chai.expect(migrated.outlines.board.main.type).to.be.undefined
    })

    it('should migrate v3 pcb footprint syntax', () => {
        const v3_config = {
            pcbs: {
                main: {
                    footprints: {
                        promicro: {
                            type: 'promicro',
                            anchor: {x: 10},
                            nets: {VCC: 'VCC'},
                            params: {
                                orientation: 'down'
                            }
                        }
                    }
                }
            }
        }
        const migrated = prepare.migrate(v3_config)
        migrated.pcbs.main.footprints.promicro.what.should.equal('promicro')
        migrated.pcbs.main.footprints.promicro.params.anchor.should.deep.equal({x: 10})
        migrated.pcbs.main.footprints.promicro.params.nets.should.deep.equal({VCC: 'VCC'})
        migrated.pcbs.main.footprints.promicro.params.orientation.should.equal('down')
    })

    it('should set meta.engine to current version', () => {
        const v3_config = {
            meta: {
                engine: '3.1.2'
            },
            points: { zones: { matrix: {} } }
        }
        const current_version = require('../../package.json').version
        const migrated = prepare.migrate(v3_config)
        migrated.meta.engine.should.equal(current_version)
    })
})
