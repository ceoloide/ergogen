const upgrade = require('../../src/upgrade')
const chai = require('chai')
chai.should()

describe('Upgrade', function() {
    it('should detect v3 configs correctly', function() {
        upgrade.detectV3({meta: {engine: '3.1.2'}}).should.be.true
        upgrade.detectV3({points: {zones: {z: {columns: {c: {stagger: 5}}}}}}).should.be.true
        upgrade.detectV3({outlines: {exports: {}}}).should.be.true
        upgrade.detectV3({meta: {engine: '4.0.0'}}).should.be.false
        upgrade.detectV3({}).should.be.false
    })

    it('should upgrade points zones correctly', function() {
        const v3 = {
            points: {
                zones: {
                    main: {
                        columns: {
                            col1: {
                                stagger: 5,
                                spread: 19,
                                rotate: 10,
                                origin: [0, 0]
                            }
                        }
                    }
                }
            }
        }
        const v4 = upgrade.upgrade(v3)
        v4.points.zones.main.columns.col1.should.not.have.property('stagger')
        v4.points.zones.main.columns.col1.should.not.have.property('spread')
        v4.points.zones.main.columns.col1.key.stagger.should.equal(5)
        v4.points.zones.main.columns.col1.key.spread.should.equal(19)
        v4.points.zones.main.columns.col1.key.splay.should.equal(10)
        v4.points.zones.main.columns.col1.key.origin.should.deep.equal([0, 0])
    })

    it('should fix asym values', function() {
        const v3 = {
            points: {
                key: { asym: 'left' }
            },
            outlines: {
                exports: {
                    main: {
                        p1: { asym: 'right' }
                    }
                }
            }
        }
        const v4 = upgrade.upgrade(v3)
        v4.points.key.asym.should.equal('source')
        v4.outlines.main.p1.asym.should.equal('clone')
    })

    it('should flat outlines.exports and fix type/what', function() {
        const v3 = {
            outlines: {
                exports: {
                    main: {
                        part1: { type: 'rectangle', size: 10 }
                    }
                }
            }
        }
        const v4 = upgrade.upgrade(v3)
        v4.outlines.should.have.property('main')
        v4.outlines.main.part1.should.have.property('what', 'rectangle')
        v4.outlines.main.part1.should.not.have.property('type')
    })

    it('should map type: keys to what: rectangle with where: true', function() {
        const v3 = {
            outlines: {
                exports: {
                    main: {
                        part1: { type: 'keys', size: 18 }
                    }
                }
            }
        }
        const v4 = upgrade.upgrade(v3)
        v4.outlines.main.part1.what.should.equal('rectangle')
        v4.outlines.main.part1.where.should.equal(true)
        v4.outlines.main.part1.bound.should.equal(true)
    })

    it('should adjust rectangle shift for center-alignment', function() {
        const v3 = {
            outlines: {
                exports: {
                    main: {
                        part1: { type: 'rectangle', size: [10, 20] }
                    }
                }
            }
        }
        const v4 = upgrade.upgrade(v3)
        v4.outlines.main.part1.adjust.shift.should.deep.equal([5, 10])
    })

    it('should handle formula sizes for rectangle alignment', function() {
        const v3 = {
            outlines: {
                exports: {
                    main: {
                        part1: { type: 'rectangle', size: ['u', 'u+2'] }
                    }
                }
            }
        }
        const v4 = upgrade.upgrade(v3)
        v4.outlines.main.part1.adjust.shift.should.deep.equal(['(u) / 2', '(u+2) / 2'])
    })

    it('should handle complex real test case', function() {
        const v3 = {
            points: {
                zones: {
                    board: {
                        columns: {
                            pinkie: {
                                rotate: 30,
                                row_overrides: {
                                    home: { column_net: 'P1' }
                                }
                            }
                        }
                    }
                }
            },
            outlines: {
                exports: {
                    raw: [
                        { type: 'keys', side: 'left', size: ['1cx', '1cy'] }
                    ],
                    cutouta: [
                        { type: 'outline', name: 'raw', fillet: 2 }
                    ]
                }
            }
        }
        const v4 = upgrade.upgrade(v3)
        v4.points.zones.board.columns.pinkie.key.splay.should.equal(30)
        v4.points.zones.board.columns.pinkie.rows.home.column_net.should.equal('P1')
        v4.outlines.raw[0].what.should.equal('rectangle')
        v4.outlines.raw[0].where.should.deep.equal({mirrored: false})
        v4.outlines.raw[0].adjust.shift.should.deep.equal(['(1cx) / 2', '(1cy) / 2'])
        v4.outlines.cutouta[0].what.should.equal('outline')
        v4.outlines.cutouta[0].name.should.equal('raw')
    })
})
