import { Schema, SimpleSchema } from "../lib/schema.js"
import { Bool, enumOfStrings, enumOfStringsSimple, extendSchema, Id, prim, ref, String } from "../lib/utils.js"
import fs from 'fs'
import { toBinary } from "../lib/write.js"
import { metaSchema } from "../lib/metaschema.js"

const tldrawTest = () => {
  const testSchema: SimpleSchema = {
    id: 'Shape',
    // root: ref('Shape'),
    root: {type: 'list', fieldType: ref('Shape')},
    types: {
      Shape: {
        type: 'struct',
        fields: {
          x: {type: 'f32'},
          y: {type: 'f32'},
          rotation: {type: 'f32'},
          id: {type: Id},
          parentId: {type: Id},
          index: {type: String},
          typeName: {type: ref('ShapeType')},
          props: {type: ref('Props')},
          // {key: 'type', valType: enumOfStrings(['geo', 'arrow', 'text'])},
        }
      },

      ShapeType: enumOfStringsSimple('shape'),
      Color: enumOfStringsSimple('light-blue', 'light-red', 'black', 'light-green', 'yellow', 'light-violet'),
      Size: enumOfStringsSimple('l', 'xl'),
      Alignment: enumOfStringsSimple('middle', 'start', 'end'),
      GeoType: enumOfStringsSimple('ellipse', 'rectangle'),
      Fill: enumOfStringsSimple('pattern', 'none'),
      Dash: enumOfStringsSimple('draw'),
      ArrowHead: enumOfStringsSimple('arrow', 'none'),

      Props: {
        type: 'enum',
        numericOnly: false,
        closed: false,
        typeFieldOnParent: 'type',
        variants: {
          text: { associatedData: {
            type: 'struct',
            fields: {
              opacity: {type: String},
              color: {type: ref('Color')},
              size: {type: ref('Size')},
              w: {type: 'u32'},
              text: {type: String},
              font: {type: String},
              align: {type: ref('Alignment')},
              autoSize: {type: Bool},
            }
          }},

          geo: { associatedData: {
            type: 'struct',
            // encodeOptional: 'none',
            fields: {
              w: {type: 'f32'},
              h: {type: 'f32'},
              geo: {type: ref('GeoType')},
              color: {type: ref('Color')},
              fill: {type: ref('Fill')},
              dash: {type: ref('Dash')},
              size: {type: ref('Size')},
              opacity: {type: String}, // Why is this a string?
              font: {type: String}, // Or enumOfStrings(['draw'])
              text: {type: String},
              align: {type: ref('Alignment')},
              growY: {type: 'u32'},
            }
          }},

          arrow: { associatedData: {
            type: 'struct',
            // encodeOptional: 'none',
            fields: {
              opacity: {type: String}, // Why is this a string?
              dash: {type: ref('Dash')},
              size: {type: ref('Size')},
              fill: {type: ref('Fill')},
              color: {type: ref('Color')},
              w: {type: 'f32'},
              h: {type: 'f32'},
              bend: {type: 'f32'},

              start: {type: ref('ArrowEnd')},
              end: {type: ref('ArrowEnd')},

              arrowheadStart: {type: ref('ArrowHead')},
              arrowheadEnd: {type: ref('ArrowHead')},
            }
          }}
        }
      },

      Vec2: {
        type: 'struct',
        fields: {
          x: {type: 'f32'},
          y: {type: 'f32'}
        }
      },

      ArrowEnd: {
        type: 'struct',
        fields: {
          x: {type: 'f32'},
          y: {type: 'f32'},
          binding: {type: Id},
          anchor: {type: ref('Vec2')}
        }
      }
    }
  }

  console.log('\n\n')
  const shapes = JSON.parse(fs.readFileSync('./tldraw-example.json', 'utf8')).data.shape
  // console.log(shapes)
  const fullSchema = extendSchema(testSchema)

  // console.log(fullSchema)
  const sOut = toBinary(metaSchema, fullSchema)
  console.log('schema', sOut)
  fs.writeFileSync('tld_schema.scb', sOut)


  let out = toBinary(fullSchema, shapes)
  // const out = readData(testSchema, shapes)
  console.log('Output length', out.length)
  fs.writeFileSync('tld2.scb', out)

}

// tldrawTest()