// constants
const width = Math.min($(window).width() * 0.7, 960 * 0.9);
const height = Math.min($(window).height() * 0.8, 700 * 0.9);

const NODE_RADIUS = 50;
const PADDING_TOP = 120;
const PADDING_BOTTOM = 100;
const PADDING_WIDTH = 125;
const FEATURE_OFFSET = 75;
const BAR_CHART_OFFSET = 6;
const TRIANGLE_LENGTH = 7;

const K = 2; // num. workers
const NUM_SAMPLES = tree_data['samples'];
const FEATURES = [
        'bath',
        'beds',
        'elevation',
        'price',
        'price_per_sqft',
        'sqft',
        'year_built',
      ];

function assert(condition, message) {
    if (!condition) {
        message = message || "Assertion failed";
        if (typeof Error !== "undefined") {
            throw new Error(message);
        }
        throw message; // Fallback
    }
}

var BarChart = Backbone.View.extend({
  initialize: function(args) {
    this.key = args.key;
    this.parentElem = args.g;

    this.height = 0.4*FEATURE_OFFSET;
    this.orientation = 'HORIZONTAL';

    this.barWidth = 1.1;
    this.barGap = 0.25;
    this.growth = 1;

    this.handleResize({
      height: this.height
    });

    this.cid = this.cid + 'BarChart'

    // this.rr = true;
  },

  handleResize: function(args) {
    _.extend(this, args);

    this.magnitudeEdge = this.height;

    if (args.barWidth) { this.barWidth = args.barWidth; }
    if (args.barGap) { this.barGap = args.barGap; }

    this.sectionWidth = this.barWidth + this.barGap;
    this.totalWidth = this.sectionWidth * NUM_SAMPLES;
    // this.rr = true;
  },

  /**
   * Helper function -- returns function that can be passed to Fill_FN
   * for determining color of bar
   **/
  isTargetFn: function(labels) {
    var fn = function(d, i) {
      return labels[i] > 0.5;
    };
    return fn;
  },

  render: function(args) {
    _.extend(this, args);
    var v = this;

    this.isTargetPred = this.isTargetFn(this.labels);

    var extent = d3.extent(this.data);
    this.barScale = d3.scale.linear()
      .domain([extent[0], extent[1]])
      .range([0.5, this.magnitudeEdge*this.growth]);

    if (args.splitIndex) {
      // If there's a split value passed in, show it
      var v = this;
      this.splitLocation = this.totalWidth * (args.splitIndex / NUM_SAMPLES);
    } else {
      this.splitLocation = null;
    }

    // append new group for barChart, position it underneath the label
    if (!this.g) {
      this.g = d3.select(this.parentElem).append('g')
        .attr('class', 'barChart')
        .attr('transform', 'translate(' + (-3.1*NODE_RADIUS) + ',' + BAR_CHART_OFFSET + ')');
    }

    this.selection = this.g.selectAll('.bin').data(this.data);

    this.selection.exit().remove();

    this.selection
      .enter()
      .append('g')
      .attr('class', 'bin');

    this.selection
      .attr('transform', function(d, i) {
        return 'translate(' + (i*v.sectionWidth) + ',0)';
      })
      .each(function(d, i) {
        d3.select(this).selectAll('rect').remove()

        d3.select(this)
          .append('rect')
          .attr('class', function(d) {
            return (v.isTargetPred(d, i)) ? 'isTarget' : 'isNotTarget';
          })
          .attr('width', function(d) {
            return v.barWidth;
          })
          .attr('height', function(d) {
            return v.barScale(d);
          })
          .attr('y', function(d) {
            return v.magnitudeEdge - v.barScale(d);
          })
          .attr('x', function(d) {
            return 0
          })
          .attr('fill', function(d) {
            return (v.isTargetPred(d, i)) ? FILL_FN('isTarget') : FILL_FN('isNotTarget');
          });
      });

    if (this.splitLocation) {
      this.splitPath = this.g.select('.split-path');

      if (this.splitPath.empty()) {
        this.splitPath = this.g.append('path')
          .classed('split-path', true)
          .attr('fill', '#606060')
          .style('fill-opacity', 0)
          .transition()
          .ease('linear')
          .duration(500)
          .style('fill-opacity', 1);
      }
      this.splitPath.transition()
      .attr('fill', args.candidate ? args.best ? 'forestgreen' : 'crimson' : '#606060')
      .duration(500);

      var x = this.splitLocation;
      var y = this.magnitudeEdge + 5;

      // Draw triangle to show split
      var path = '';
      path += 'M ' + x + ' ' + y + ' ';
      path += 'L ' + (x + TRIANGLE_LENGTH) + ' ' + (y + TRIANGLE_LENGTH) + ' ';
      path += 'L ' + (x - TRIANGLE_LENGTH) + ' ' + (y + TRIANGLE_LENGTH) + ' ';
      path += 'Z';

      this.splitPath.attr('d', path);
    } else {
      this.splitPath = this.g.select('.split-path');
      if (!this.splitPath.empty()) {
        this.splitPath.remove();
      }
    }

    return this;
  }
});

var YggdrasilAlgo = Backbone.View.extend({

  /**
   * Constructor
   **/
  initialize: function(args) {
    var v = this;

    /**
     * Helper function to create master and worker circles
     **/
    var createMasterAndWorkers = function(labels) {
      var nodes = v.svg.selectAll('g.node').data(nodeLabels);

      var newNodes = nodes.enter()
        .append('g')
        .attr('class', 'node')
        .attr('transform', function(d, i) {
          var nodeCoords = v.getNodeCoordinates(i);
          return 'translate(' + nodeCoords.x + ', ' +  nodeCoords.y + ')';
        });

      newNodes.append('circle')
        .attr('r', NODE_RADIUS)
        .style('stroke', '#000')
        .style('fill', function(d, i) {
          if (i == 0) {
            return '#f6f6f6';
          } else {
            return '#eaeaea';
          }
        });

      newNodes.append('text')
        .attr('class', 'node-label')
        .attr('text-anchor', 'middle')
        .attr('dx', 0)
        .attr('dy', 10)
        .style('font-size', '0.7em')
        .text(function(d) { return d });
    };

    /**
     * Helper function to find splits at each depth in the tree
     **/
    var parseSplitsFromTreeData = function(tree_data, tree_stats) {
      tree_data['depth'] = 0;
      var queue = [tree_data];
      var depthToSplits = d3.map();
      while (queue.length > 0) {
        var node = queue.shift();
        var depth = node.depth;
        var stat_node = tree_stats[node.id];
        if (stat_node.has_children) {
          var splitLocation = stat_node.split_location;
          if (!depthToSplits.has(depth)) {
            depthToSplits.set(depth, []);
          }
          depthToSplits.get(depth).push(splitLocation);

          for (var i = 0; i < node.children.length; ++i) {
            node.children[i]['depth'] = depth + 1;
            queue.push(node.children[i]);
          }
        }
      }
      return depthToSplits;
    };

    this.depthToSplits = parseSplitsFromTreeData(tree_data, tree_stats);

    // need this later to compute bitvectors
    this.dataIndexToColIndex = d3.map(_.range(NUM_SAMPLES), function(d) {
      return tree_training_set[d]['index'];
    });

    // Data by columns, array of {featureName:, featureValues:[], labels: []}
    this.dataByColumns = _.map(FEATURES, function(feature) {
      var valuesAndLabels = _.chain(tree_training_set)
          .map(function(datum) {
            return [datum[feature], datum['target']];
          })
          .shuffle()
          .unzip()
          .value();
      return {
        featureName: feature,
        featureValues: valuesAndLabels[0],
        labels: valuesAndLabels[1]
      };
    });

    // initially, if no argument is specified, we're in state 0
    this.state = args.state || 0;

    this.svg = d3.select('#' + args.id).append('svg')
      .attr('width', width)
      .attr('height', height);

    var nodeLabels = ['master'];
    for (var i = 0; i < K; ++i) {
      nodeLabels.push('worker');
    }
    createMasterAndWorkers(nodeLabels);
  },

  /**
   * Return bit vector (array of 0's and 1's)
   * encoding the split(s) for a given depth
   * in the tree
   **/
  getBitVectorForDepth: function(depth) {
    var v = this;
    var splits = this.depthToSplits.get(depth);
    var bitVector = new Array(NUM_SAMPLES);
    _.forEach(splits, function(split) {
      _.forEach(split.left_side, function(d) {
        bitVector[v.dataIndexToColIndex.get(d)] = 0;
      });
      _.forEach(split.right_side, function(d) {
        bitVector[v.dataIndexToColIndex.get(d)] = 1;
      });
    });
    return bitVector;
  },

  /**
   * Get x and y coordinate for a master (index 0)
   * or worker node (index >= 1)
   **/
  getNodeCoordinates: function(index) {
    switch (index) {
      case 0:
        return {
          x: (width / 2),
          y: (1.1*NODE_RADIUS)
        };
      case 1:
        return {
          x: (NODE_RADIUS + PADDING_WIDTH),
          y: (NODE_RADIUS + PADDING_TOP)
        };
      case 2:
        return {
          x: (width - PADDING_WIDTH - NODE_RADIUS),
          y: (NODE_RADIUS + PADDING_TOP)
        };
      case 3:
        return {
          x: (NODE_RADIUS + PADDING_WIDTH),
          y: (height - PADDING_BOTTOM - NODE_RADIUS)
        };
      case 4:
        return {
          x: (width - PADDING_WIDTH - NODE_RADIUS),
          y: (height - PADDING_BOTTOM - NODE_RADIUS)
        };
    }
  },

  /**
  /* assign all features to master
  /**/
  allOnMaster: function() {
   return _.chain(FEATURES.length)
      .range()
      .map(function(i) {
        return {
          node: 0,
          index: i
        };
      })
      .value();
  },

  /**
   * divide up the features amongst the workers
   **/
  partitionToWorkers: function() {
    if (!this.partitionToWorkersCache) {
      this.partitionToWorkersCache = _.chain(FEATURES.length)
        .range()
        .map(function(i) {
          return {
            node: Math.floor(i % K) + 1,
            index: Math.floor(i / K)
          };
        })
        .shuffle()
        .value();
    }
    return this.partitionToWorkersCache;
  },

  /**
   * compute split for each feature
   **/
  computeSplits: function(sortedColumns) {
     if (!this.computeSplitsCache) {
       this.computeSplitsCache = _.map(sortedColumns, function(d) {
         // don't actually compute any stats; for now,
         // just return the index of the median value
         // if the split wasn't pre-computed
         var splitPoint = (d.featureName === tree_data.key)
                           ? parseFloat(tree_data.value)
                           : d3.median(d.featureValues);
         // for now, the gain for all other features
         // is a random number that must be less than
         // the pre-computed gain
         var gain = (d.featureName === tree_data.key)
                     ? parseFloat(tree_data.gini)
                     : Math.random() * parseFloat(tree_data.gini);
         return {
           featureName: d.featureName,
           index: d3.bisectLeft(d.featureValues, splitPoint),
           split: splitPoint,
           infoGain: gain
         };
       });
     }
     return this.computeSplitsCache;
  },

  /**
   * find best feature split per worker
   **/
  bestSplitPerWorker: function(splits, workerAssignments) {
    var assignmentsPerNode = _.chain(workerAssignments)
      .map(function(d, i) {
        return {
          node: d.node,
          index: i
        };
      })
      .groupBy(function(d) {
        return d.node;
      })
      .value();
    var result = _.map(assignmentsPerNode, function(splitsOnNode) {
      var feature = '';
      var maxInfoGain = 0.0;
      _.forEach(splitsOnNode, function(d) {
        var split = splits[d.index];
        if (split.infoGain >= maxInfoGain) {
          feature = FEATURES[d.index];
          maxInfoGain = split.infoGain;
        }
      });
      return feature;
    });
    assert(result.indexOf('elevation') > -1, '"elevation" is not one of the best splits! ' + result.toString());

    return result;
  },

  /**
   * sort feature on worker by bitvector, then by value
   **/
  sortFeatureOnWorker: function(bitVector) {
    return _.map(this.dataByColumns, function(feature) {
      var valueAndLabel = _.chain(feature.featureValues)
        .zip(feature.labels)
        .sortBy(function(val) {
          return parseFloat(val[0]);
        })
        .sortBy(function(val, index) {
          return bitVector[index];
        })
        .unzip()
        .value();

      return {
        featureName: feature.featureName,
        featureValues: valueAndLabel[0],
        labels: valueAndLabel[1]
      };
    });
  },

  /**
   * Render algorithm stage, based on args.state (must be 0-6)
   **/
  update: function(args) {
    _.extend(this, args);

    // Default values to pass to render
    var depth = 0;
    var featureData = this.dataByColumns;
    var splits = [];
    var bestFeatures = [];
    var bv = null;
    var broadcast = true;
    switch (this.state) {
      case 0:
        this.workerAssignments = this.allOnMaster();
        break;
      case 1:
        this.workerAssignments = this.partitionToWorkers();
        break;
      case 2:
        featureData = this.sortFeatureOnWorker(_.range(NUM_SAMPLES).map(function() { return 0; }));
        break;
      case 3:
        featureData = this.sortFeatureOnWorker(_.range(NUM_SAMPLES).map(function() { return 0; }));
        splits = this.computeSplits(featureData);
        break;
      case 4:
        featureData = this.sortFeatureOnWorker(_.range(NUM_SAMPLES).map(function() { return 0; }));
        splits = this.computeSplits(featureData);
        bestFeatures = this.bestSplitPerWorker(splits, this.workerAssignments);
        break;
      case 5:
        // can't fit all the bits, so just sample 50 of them
        this.bv = _.sample(this.getBitVectorForDepth(depth), 50).join('');
        broadcast = false;
      case 6:
        bv = this.bv;
        featureData = this.sortFeatureOnWorker(_.range(NUM_SAMPLES).map(function() { return 0; }));
        splits = this.computeSplits(featureData);
        bestFeatures = ['elevation']; // hard code it for now
        break;
      case 7:
        featureData = this.sortFeatureOnWorker(this.getBitVectorForDepth(depth));
        depth = 1;
        break;
    }
    debugger;
    this.render(featureData, this.workerAssignments, depth,
        _.map(splits, function(d) { return d.index; }), bestFeatures,
        bv, broadcast);
  },

  /**
   * Called by render to update display after updating state machine
   **/
  render: function(featureData, partitions, depth, splits, bestFeaturePerWorker, bitVector, broadcast) {
    var v = this;
    var positionFeature = function(d, i) {
      var locInfo = partitions[i];
      var nodeCoords = v.getNodeCoordinates(locInfo.node);
      return 'translate(' + nodeCoords.x + ', ' +  (nodeCoords.y + 1.5*NODE_RADIUS + locInfo.index*FEATURE_OFFSET) + ')';
    };

    this.svg.selectAll('text.bit-vector').remove();
    if (bitVector) {
      var masterCoords = v.getNodeCoordinates(0);
      if (broadcast) {
        // send bitvector to all workers
        for (var i = 0; i < K; ++i) {
          var workerCoords = v.getNodeCoordinates(i + 1);
          this.svg.append('text')
            .text(bitVector)
            .classed('bit-vector', true)
            .attr('text-anchor', 'middle')
            .style('font-size', '0.40em')
            // these next two lines squish the characters so that
            // they fit in only 200px
            .attr('textLength', 200)
            .attr('lengthAdjust', 'spacingAndGlyphs')
            .attr('x', masterCoords.x)
            .attr('y', masterCoords.y + NODE_RADIUS / 2)
            // move bitvector from master to worker
            .transition()
            .attr('x', workerCoords.x)
            .attr('y', workerCoords.y + NODE_RADIUS / 2)
            .ease('bounce')
            .duration(1000);
        }
      } else {
        var nodeIndex = partitions[FEATURES.indexOf(bestFeaturePerWorker[0])].node;
        var workerCoords = v.getNodeCoordinates(nodeIndex);
        // send bitvector from worker to master
        this.svg.append('text')
          .text(bitVector)
          .classed('bit-vector', true)
          .attr('text-anchor', 'middle')
          .style('font-size', '0.40em')
          // these next two lines squish the characters so that
          // they fit in only 200px
          .attr('textLength', 200)
          .attr('lengthAdjust', 'spacingAndGlyphs')
          .attr('x', workerCoords.x)
          .attr('y', workerCoords.y + NODE_RADIUS / 2)
          // move bitvector from master to worker
          .transition()
          .attr('x', masterCoords.x)
          .attr('y', masterCoords.y + NODE_RADIUS / 2)
          .ease('bounce')
          .duration(1000);
      }
    }

    var features = this.svg.selectAll('g.feature').data(featureData);
    features.transition()
      .attr('transform', positionFeature)
      .duration(750)
      .style('fill-opacity', 1);

    features.each(function(d, i) {
      var args = {
        data: d.featureValues,
        labels: d.labels,
        candidate: (bestFeaturePerWorker.indexOf(d.featureName) > -1),
        best: (bestFeaturePerWorker.length == 1),
        depth: depth
      };
      if (splits.length > 0) args.splitIndex = splits[i];
      this.barChart.render(args);
    });

    features.enter().append('g')
      .attr('class', 'feature')
      .each(function(d) {
        this.barChart = new BarChart({
          key: d.featureName,
          g: this
        });
        var args = {
          data: d.featureValues,
          labels: d.labels,
          candidate: (bestFeaturePerWorker.indexOf(d.featureName) > -1),
          best: (bestFeaturePerWorker.length == 1),
          depth: depth
        };
      if (splits.length > 0) args.splitIndex = splits[i];
        this.barChart.render(args);
      })
      .attr('transform', positionFeature)
      .append('text')
      .text(function(d) { return d.featureName; })
      .classed('feature-label', true)
      .attr('text-anchor', 'middle')
      .style('font-size', '0.55em')
      .attr('y', 0);

    features.selectAll('text')
      .attr('fill', function(d) {
        return (bestFeaturePerWorker.indexOf(d.featureName) > -1) ?
          (bestFeaturePerWorker.length == 1) ? 'forestgreen' : 'crimson'
          : 'blue';
      })
      .attr('font-weight', function(d) {
        return (bestFeaturePerWorker.indexOf(d.featureName) > -1) &&
               (bestFeaturePerWorker.length == 1) ? 'bold' : 'normal';
      })
      .attr('text-decoration', function(d) {
        return (bestFeaturePerWorker.indexOf(d.featureName) > -1) &&
               (bestFeaturePerWorker.length == 1) ? 'underline' : 'none';
      })
      .classed('grow', function(d) { return bestFeaturePerWorker.indexOf(d.featureName) > -1; });

    features.exit().remove();
  }
});

// now sort each column by value, and update the labels
// setTimeout(function() {
//   update(dataByColumns, workerAssignments, -1);
// }, 4000);

// now train
// var depth = 0;
// function train() {
//   var bv = getBitVectorForDepth(depth);
//   sortFeatureOnWorker(bv);
//   update(dataByColumns, workerAssignments, depth);
//   depth++;
//   if (depth < 1) {
//     setTimeout(train, 2000);
//   }
// }
// setTimeout(train, 6000);

