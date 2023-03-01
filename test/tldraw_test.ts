import { Schema, SimpleSchema } from "./schema.js"
import { enumOfStrings, enumOfStringsSimple, extendSchema, ref } from "./utils.js"
import fs from 'fs'
import { toBinary } from "./write.js"

const tldrawTest = () => {
  const testSchema: SimpleSchema = {
    id: 'Shape',
    // root: ref('Shape'),
    root: {type: 'list', fieldType: ref('Shape')},
    types: {
      Shape: {
        type: 'struct',
        // encodingOrder: ['id', 'x', 'y', 'rotation', 'parentId', 'index', 'props'], // 'typeName',
        fields: {
          x: {type: 'f32'},
          y: {type: 'f32'},
          rotation: {type: 'f32'},
          id: {type: 'id'},
          parentId: {type: 'id'},
          index: {type: 'string'},
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
            // encodingOrder: ['opacity', 'color', 'size', 'w', 'text', 'font', 'align', 'autoSize'],
            fields: {
              opacity: {type: 'string'},
              color: {type: ref('Color')},
              size: {type: ref('Size')},
              w: {type: 'u32'},
              text: {type: 'string'},
              font: {type: 'string'},
              align: {type: ref('Alignment')},
              autoSize: {type: 'bool'},
            }
          }},

          geo: { associatedData: {
            type: 'struct',
            // encodeOptional: 'none',
            // encodingOrder: ['w', 'h', 'geo', 'color']
            fields: {
              w: {type: 'f32'},
              h: {type: 'f32'},
              geo: {type: ref('GeoType')},
              color: {type: ref('Color')},
              fill: {type: ref('Fill')},
              dash: {type: ref('Dash')},
              size: {type: ref('Size')},
              opacity: {type: 'string'}, // Why is this a string?
              font: {type: 'string'}, // Or enumOfStrings(['draw'])
              text: {type: 'string'},
              align: {type: ref('Alignment')},
              growY: {type: 'u32'},
            }
          }},

          arrow: { associatedData: {
            type: 'struct',
            // encodeOptional: 'none',
            fields: {
              opacity: {type: 'string'}, // Why is this a string?
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
          binding: {type: 'id'},
          anchor: {type: ref('Vec2')}
        }
      }
    }
  }

  console.log('\n\n')
  const shapes = JSON.parse(fs.readFileSync('./tldraw-example.json', 'utf8')).data.shape
  // console.log(shapes)
  let out = toBinary(extendSchema(testSchema), shapes)
  // const out = readData(testSchema, shapes)
  console.log('Output length', out.length)
  fs.writeFileSync('tld2.scb', out)

}

tldrawTest()